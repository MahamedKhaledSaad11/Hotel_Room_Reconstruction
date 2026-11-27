import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image
import pytest

from reconstruction.pipeline import PipelineConfig
from reconstruction.pipeline.export import SPLAT_DTYPE, export_scene, validate_export, write_gaussians
from reconstruction.pipeline.poses import matrix_quaternion, quaternion_matrix, read_model
from reconstruction.pipeline.train import camera_arrays, split_frames


def gaussian_arrays():
    return {"means": np.array([[1, 2, 3], [-2, 1, 4], [0, -1, 2], [1, 0, 6]], np.float32),
            "scales": np.log(np.full((4, 3), 0.2, np.float32)),
            "quats": np.tile(np.array([1, 0, 0, 0], np.float32), (4, 1)),
            "opacities": np.zeros(4, np.float32), "sh0": np.zeros((4, 1, 3), np.float32),
            "shN": np.zeros((4, 3, 3), np.float32)}


def test_gaussian_export_binary_contract_and_sh_ply(tmp_path):
    arrays = gaussian_arrays()
    assert write_gaussians(tmp_path, arrays) == 4
    raw = (tmp_path/"scene.splat").read_bytes()
    assert len(raw) == 32*4
    x, y, z, sx, sy, sz, r, g, b, a, qw, qx, qy, qz = struct.unpack("<6f8B", raw[:32])
    assert [x, y, z] == pytest.approx([1, 2, 3])
    assert [sx, sy, sz] == pytest.approx([0.2]*3)
    assert [r, g, b, a] == [128, 128, 128, 128]
    assert [qw, qx, qy, qz] == [255, 128, 128, 128]
    ply = (tmp_path/"scene.ply").read_bytes()
    header = ply[:ply.index(b"end_header\n")].decode()
    assert "property float f_rest_8" in header
    assert "property float opacity" in header
    assert "property float rot_0" in header
    with pytest.raises(ValueError, match="non-finite"):
        arrays["means"][0, 0] = np.nan
        write_gaussians(tmp_path, arrays)


def test_manifest_transform_intrinsics_and_export_validation(tmp_path):
    arrays = gaussian_arrays()
    frames = []
    for i in range(12):
        image = tmp_path/"images"/f"frame_{i:06d}.jpg"
        image.parent.mkdir(exist_ok=True)
        Image.new("RGB", (64, 48)).save(image)
        frames.append({"frame_id": image.stem, "filename": image.name, "image_path": str(image),
                       "camera_id": 1, "colmap_image_id": i+1, "status": "registered",
                       "qvec_wxyz": [1., 0., 0., 0.], "tvec_xyz": [float(i), 0., 0.]})
    camera = {"width": 64, "height": 48, "fx": 50., "fy": 50., "cx": 32., "cy": 24., "model": "PINHOLE"}
    model = {"frames": frames, "cameras": {"1": camera}, "points": arrays["means"],
             "colors": np.full((4, 3), 128, np.uint8), "metrics": {"registered_frames": 12}}
    extraction = {"source": {}, "frames": [{"frame_id": f["frame_id"], "status": "extracted"} for f in frames], "metrics": {}}
    train, holdout = split_frames(frames, 8)
    config = PipelineConfig("unused.mp4", str(tmp_path))
    manifest = export_scene(config, extraction, model, arrays, {"holdout_frame_ids": [f["frame_id"] for f in holdout]})
    assert manifest["viewer_transform"]["scene_bounds_min"] == [-2., -2., -6.]
    assert manifest["viewer_transform"]["scene_bounds_max"] == [1., 1., -2.]
    assert manifest["initial_camera"]["position"] == [0., 0., 0.]
    assert manifest["initial_camera"]["target"] == [0., 0., -1.]
    assert not {f["frame_id"] for f in train} & {f["frame_id"] for f in holdout}
    assert len(train) == 10 and len(holdout) == 2
    assert validate_export(tmp_path)["structurally_valid"]
    assert manifest["scene_versions"][0]["splat_relative_path"] == "scene.splat"
    frame = manifest["frames"][0]
    view, k, _ = camera_arrays(frame, manifest["cameras"])
    world = np.array([1., 2., 3., 1.])
    pixel_h = k @ (view @ world)[:3]
    assert pixel_h[:2]/pixel_h[2] == pytest.approx([50/3+32, 100/3+24])
    with (tmp_path/"scene.splat").open("ab") as handle:
        handle.write(b"x")
    with pytest.raises(ValueError, match="length"):
        validate_export(tmp_path)


@pytest.mark.parametrize("axis,angle", [(0, 0), (0, np.pi), (1, np.pi), (2, np.pi), (0, .8), (1, 1.3), (2, -2.4)])
def test_quaternion_matrix_roundtrip_handles_half_turns(axis, angle):
    q = np.zeros(4)
    q[0], q[axis+1] = np.cos(angle/2), np.sin(angle/2)
    matrix = quaternion_matrix(q)
    np.testing.assert_allclose(quaternion_matrix(matrix_quaternion(matrix)), matrix, atol=1e-12)


def test_text_model_reader_handles_empty_tracks_and_noncontiguous_ids(tmp_path):
    images, sparse = tmp_path/"images", tmp_path/"sparse"
    images.mkdir()
    sparse.mkdir()
    (sparse/"cameras.txt").write_text("# Camera list\n7 PINHOLE 64 48 50 50 32 24\n")
    lines = ["# Image list"]
    for i in [2, 10, 20]:
        Image.new("RGB", (64, 48)).save(images/f"frame_{i}.jpg")
        lines.extend([f"{i} 1 0 0 0 0 0 0 7 frame_{i}.jpg", ""])
    (sparse/"images.txt").write_text("\n".join(lines)+"\n")
    (sparse/"points3D.txt").write_text("\n".join(f"{i} {i} 0 2 255 0 0 0" for i in range(1, 5))+"\n")
    model = read_model(sparse, images)
    assert len(model["frames"]) == 3
    assert len(model["points"]) == 4
    assert model["cameras"]["7"]["fx"] == 50


def test_text_model_rejects_distorted_training_cameras(tmp_path):
    (tmp_path/"cameras.txt").write_text("1 SIMPLE_RADIAL 64 48 50 32 24 .1\n")
    with pytest.raises(ValueError, match="undistorted"):
        read_model(tmp_path, tmp_path)
