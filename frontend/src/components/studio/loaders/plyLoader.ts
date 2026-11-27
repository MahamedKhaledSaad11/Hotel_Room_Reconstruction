import * as THREE from 'three';

const SH_C0 = 0.28209479177387814;

export type PlyFormat = 'ascii' | 'binary_little_endian' | 'binary_big_endian';

export class PlyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlyParseError';
  }
}

export interface ParsedPlyData {
  count: number;
  format: PlyFormat;
  positions: Float32Array;
  colors: Float32Array;
  boundingBox: THREE.Box3;
  geometry: THREE.BufferGeometry;
  skippedInvalidCount: number;
}

export interface ParsePlyOptions {
  /** Optional 4x4 transform applied to positions (e.g. COLMAP -> Three.js). */
  transformMatrix?: THREE.Matrix4;
}

interface PlyProperty {
  name: string;
  type: string;
  byteSize: number;
  offset: number;
}

const PLY_TYPE_SIZES: Record<string, number> = {
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

function findHeaderEnd(bytes: Uint8Array): { headerText: string; bodyOffset: number } {
  // Search for "end_header" followed by \n or \r\n within the first 64 KB
  const limit = Math.min(bytes.length, 65536);
  const decoder = new TextDecoder('ascii');
  const probe = decoder.decode(bytes.subarray(0, limit));
  const match = /(?:^|\r?\n)end_header(?:\r?\n|$)/.exec(probe);
  if (!match) {
    throw new PlyParseError('Invalid .ply file: missing "end_header" marker.');
  }
  const endOffset = match.index + match[0].length;
  // ASCII header bytes match character index 1:1
  return {
    headerText: probe.slice(0, match.index + match[0].length),
    bodyOffset: endOffset,
  };
}

function readBinaryScalar(
  view: DataView,
  offset: number,
  type: string,
  littleEndian: boolean
): number {
  switch (type) {
    case 'char':
    case 'int8':
      return view.getInt8(offset);
    case 'uchar':
    case 'uint8':
      return view.getUint8(offset);
    case 'short':
    case 'int16':
      return view.getInt16(offset, littleEndian);
    case 'ushort':
    case 'uint16':
      return view.getUint16(offset, littleEndian);
    case 'int':
    case 'int32':
      return view.getInt32(offset, littleEndian);
    case 'uint':
    case 'uint32':
      return view.getUint32(offset, littleEndian);
    case 'float':
    case 'float32':
      return view.getFloat32(offset, littleEndian);
    case 'double':
    case 'float64':
      return view.getFloat64(offset, littleEndian);
    default:
      throw new PlyParseError(`Unsupported PLY scalar type: "${type}".`);
  }
}

function normalizeRgbChannel(raw: number, type: string): number {
  if (!Number.isFinite(raw)) return 0.75;
  if (type === 'uchar' || type === 'uint8') {
    return Math.min(1, Math.max(0, raw / 255));
  }
  if (type === 'ushort' || type === 'uint16') {
    return Math.min(1, Math.max(0, raw / 65535));
  }
  if (type === 'char' || type === 'int8') {
    return Math.min(1, Math.max(0, raw / 127));
  }
  // Float/double: usually [0, 1], occasionally [0, 255] if converted carelessly
  if (raw > 1.0 && raw <= 255.0) {
    return Math.min(1, Math.max(0, raw / 255));
  }
  return Math.min(1, Math.max(0, raw));
}

function shDcToRgb(dc: number): number {
  if (!Number.isFinite(dc)) return 0.75;
  return Math.min(1, Math.max(0, 0.5 + SH_C0 * dc));
}

/**
 * Parses ASCII or binary little-endian (or big-endian) `.ply` sparse point clouds
 * (including COLMAP `x,y,z,red,green,blue` and 3DGS `f_dc_0,f_dc_1,f_dc_2` schemas)
 * into a Three.js BufferGeometry with bounding box calculation.
 */
export function parsePlyBuffer(
  buffer: ArrayBuffer,
  options: ParsePlyOptions = {}
): ParsedPlyData {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new PlyParseError('Expected an ArrayBuffer for .ply parsing.');
  }
  if (buffer.byteLength === 0) {
    throw new PlyParseError('Empty .ply buffer (0 bytes).');
  }

  const bytes = new Uint8Array(buffer);
  const { headerText, bodyOffset } = findHeaderEnd(bytes);
  const lines = headerText.split(/\r?\n/).map((l) => l.trim());

  if (lines[0] !== 'ply') {
    throw new PlyParseError('Invalid .ply file: header does not start with "ply".');
  }

  let format: PlyFormat | null = null;
  let vertexCount = -1;
  let currentElement = '';
  const vertexProps: PlyProperty[] = [];
  let vertexStride = 0;

  for (const line of lines) {
    if (!line || line === 'ply' || line === 'end_header' || line.startsWith('comment') || line.startsWith('obj_info')) {
      continue;
    }
    const tokens = line.split(/\s+/);
    const kw = tokens[0];
    if (kw === 'format') {
      const fmt = tokens[1];
      if (fmt === 'ascii' || fmt === 'binary_little_endian' || fmt === 'binary_big_endian') {
        format = fmt;
      } else {
        throw new PlyParseError(`Unsupported .ply format: "${fmt}".`);
      }
    } else if (kw === 'element') {
      currentElement = tokens[1] ?? '';
      if (currentElement === 'vertex') {
        const parsedCount = Number.parseInt(tokens[2] ?? '', 10);
        if (!Number.isFinite(parsedCount) || parsedCount < 0) {
          throw new PlyParseError(`Invalid vertex count in .ply header: "${tokens[2] ?? ''}".`);
        }
        vertexCount = parsedCount;
      }
    } else if (kw === 'property' && currentElement === 'vertex') {
      if (tokens[1] === 'list') {
        throw new PlyParseError('List properties inside PLY vertex element are not supported.');
      }
      const propType = tokens[1];
      const propName = tokens[2];
      if (!propType || !propName) {
        throw new PlyParseError(`Malformed PLY property line: "${line}".`);
      }
      const byteSize = PLY_TYPE_SIZES[propType];
      if (!byteSize) {
        throw new PlyParseError(`Unsupported PLY property type "${propType}" for "${propName}".`);
      }
      vertexProps.push({
        name: propName,
        type: propType,
        byteSize,
        offset: vertexStride,
      });
      vertexStride += byteSize;
    }
  }

  if (!format) {
    throw new PlyParseError('Invalid .ply file: missing "format" declaration.');
  }
  if (vertexCount <= 0) {
    throw new PlyParseError(`Invalid .ply file: vertex count is ${vertexCount} (expected > 0).`);
  }

  const propByName = new Map<string, { prop: PlyProperty; index: number }>();
  vertexProps.forEach((prop, index) => {
    propByName.set(prop.name, { prop, index });
  });

  const xProp = propByName.get('x');
  const yProp = propByName.get('y');
  const zProp = propByName.get('z');
  if (!xProp || !yProp || !zProp) {
    throw new PlyParseError('Invalid .ply file: vertex element is missing x, y, or z properties.');
  }

  const rProp = propByName.get('red') ?? propByName.get('r');
  const gProp = propByName.get('green') ?? propByName.get('g');
  const bProp = propByName.get('blue') ?? propByName.get('b');
  const hasRgb = Boolean(rProp && gProp && bProp);

  const fdc0Prop = propByName.get('f_dc_0');
  const fdc1Prop = propByName.get('f_dc_1');
  const fdc2Prop = propByName.get('f_dc_2');
  const hasShDc = !hasRgb && Boolean(fdc0Prop && fdc1Prop && fdc2Prop);

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const boundingBox = new THREE.Box3();
  const hasTransform = Boolean(options.transformMatrix);
  const transformMat = options.transformMatrix ?? new THREE.Matrix4();
  const tmpVec = new THREE.Vector3();

  let validCount = 0;
  let skippedInvalidCount = 0;

  if (format === 'ascii') {
    const bodyText = new TextDecoder('utf-8').decode(bytes.subarray(bodyOffset));
    const bodyLines = bodyText.split(/\r?\n/);
    let lineIdx = 0;
    let parsedVertices = 0;

    while (parsedVertices < vertexCount && lineIdx < bodyLines.length) {
      const rawLine = bodyLines[lineIdx++].trim();
      if (!rawLine) continue;
      const cols = rawLine.split(/\s+/);
      if (cols.length < vertexProps.length) {
        throw new PlyParseError(
          `Truncated ASCII .ply vertex row at vertex ${parsedVertices}: expected ${vertexProps.length} values, got ${cols.length}.`
        );
      }
      parsedVertices++;

      const px = Number(cols[xProp.index]);
      const py = Number(cols[yProp.index]);
      const pz = Number(cols[zProp.index]);

      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
        skippedInvalidCount++;
        continue;
      }

      tmpVec.set(px, py, pz);
      if (hasTransform) {
        tmpVec.applyMatrix4(transformMat);
      }

      let cr = 0.76;
      let cg = 0.70;
      let cb = 0.64;
      if (hasRgb && rProp && gProp && bProp) {
        cr = normalizeRgbChannel(Number(cols[rProp.index]), rProp.prop.type);
        cg = normalizeRgbChannel(Number(cols[gProp.index]), gProp.prop.type);
        cb = normalizeRgbChannel(Number(cols[bProp.index]), bProp.prop.type);
      } else if (hasShDc && fdc0Prop && fdc1Prop && fdc2Prop) {
        cr = shDcToRgb(Number(cols[fdc0Prop.index]));
        cg = shDcToRgb(Number(cols[fdc1Prop.index]));
        cb = shDcToRgb(Number(cols[fdc2Prop.index]));
      }

      const outIdx = validCount * 3;
      positions[outIdx] = tmpVec.x;
      positions[outIdx + 1] = tmpVec.y;
      positions[outIdx + 2] = tmpVec.z;
      colors[outIdx] = cr;
      colors[outIdx + 1] = cg;
      colors[outIdx + 2] = cb;

      boundingBox.expandByPoint(tmpVec);
      validCount++;
    }

    if (parsedVertices < vertexCount) {
      throw new PlyParseError(
        `Truncated ASCII .ply payload: header declared ${vertexCount} vertices, found ${parsedVertices}.`
      );
    }
  } else {
    const requiredBytes = bodyOffset + vertexCount * vertexStride;
    if (buffer.byteLength < requiredBytes) {
      throw new PlyParseError(
        `Truncated binary .ply buffer: expected at least ${requiredBytes} bytes for ${vertexCount} vertices, got ${buffer.byteLength}.`
      );
    }
    const littleEndian = format === 'binary_little_endian';
    const view = new DataView(buffer);

    for (let i = 0; i < vertexCount; i++) {
      const base = bodyOffset + i * vertexStride;
      const px = readBinaryScalar(view, base + xProp.prop.offset, xProp.prop.type, littleEndian);
      const py = readBinaryScalar(view, base + yProp.prop.offset, yProp.prop.type, littleEndian);
      const pz = readBinaryScalar(view, base + zProp.prop.offset, zProp.prop.type, littleEndian);

      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
        skippedInvalidCount++;
        continue;
      }

      tmpVec.set(px, py, pz);
      if (hasTransform) {
        tmpVec.applyMatrix4(transformMat);
      }

      let cr = 0.76;
      let cg = 0.70;
      let cb = 0.64;
      if (hasRgb && rProp && gProp && bProp) {
        cr = normalizeRgbChannel(
          readBinaryScalar(view, base + rProp.prop.offset, rProp.prop.type, littleEndian),
          rProp.prop.type
        );
        cg = normalizeRgbChannel(
          readBinaryScalar(view, base + gProp.prop.offset, gProp.prop.type, littleEndian),
          gProp.prop.type
        );
        cb = normalizeRgbChannel(
          readBinaryScalar(view, base + bProp.prop.offset, bProp.prop.type, littleEndian),
          bProp.prop.type
        );
      } else if (hasShDc && fdc0Prop && fdc1Prop && fdc2Prop) {
        cr = shDcToRgb(
          readBinaryScalar(view, base + fdc0Prop.prop.offset, fdc0Prop.prop.type, littleEndian)
        );
        cg = shDcToRgb(
          readBinaryScalar(view, base + fdc1Prop.prop.offset, fdc1Prop.prop.type, littleEndian)
        );
        cb = shDcToRgb(
          readBinaryScalar(view, base + fdc2Prop.prop.offset, fdc2Prop.prop.type, littleEndian)
        );
      }

      const outIdx = validCount * 3;
      positions[outIdx] = tmpVec.x;
      positions[outIdx + 1] = tmpVec.y;
      positions[outIdx + 2] = tmpVec.z;
      colors[outIdx] = cr;
      colors[outIdx + 1] = cg;
      colors[outIdx + 2] = cb;

      boundingBox.expandByPoint(tmpVec);
      validCount++;
    }
  }

  if (validCount === 0) {
    throw new PlyParseError('No valid finite vertices found in .ply file.');
  }

  const finalPositions =
    validCount === vertexCount ? positions : positions.subarray(0, validCount * 3);
  const finalColors =
    validCount === vertexCount ? colors : colors.subarray(0, validCount * 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(finalPositions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(finalColors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return {
    count: validCount,
    format,
    positions: finalPositions,
    colors: finalColors,
    boundingBox,
    geometry,
    skippedInvalidCount,
  };
}
