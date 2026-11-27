import {
  AtelierSettings,
  Project,
  ReconstructionTask,
  UserProfile,
} from '../types';

export const STITCH_IMAGES = {
  avatarElena:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuAWD8y_sxDfpBfpeNXUZzybQOAcjBlzRiGEJiDP1GMxUmJh-AV6j4RBY2Xp1D8S0kseIEPTDe5jr3criFSebOoTkIOBDQ9es9J85aoJ3jHfMLRfqS-5L79xK8ykGuk1k4Bwn3e8at4VDcFTiww-Uw0ZL7hfPSd22iBwMEUavbgsSS80N4xmpKT3mdC8t-0lT7SYBPhUqAUMsGYh-5kbUXGuPHtCb_u_IbGg82JJn_ru',
  bohemianLiving:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuB8jfi-ZFJupV9tynKbkpE_ZWgfrW6IsjUZy1-7eBlIpA6xA7oKEL7fNJ7iVHoU1Pj3sYdQwu9pIAOZVTsY9gPv_06RjipplD0Jb1CvKu_bVwo8puIUJm5VNJOrzNb37alcHWUIkBqr9Tys0oKA7hV-d_wzP1MLvZ3RKpP7lr-HnQIdlFc8q21Hdf481nSbTOxTiqfe9P9R_-5GcUBpgB67Gc-Amz1ubt-la70vcomB',
  industrialLoft:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuA6vzA5yevMSb42LIXUcugYKgyLofQUANF8Ydi5Sf1wCE3gY178xvWpg2ewFloGUO-Oi1X4cRYPOjUozlOfQXxpsv3dYQS_k412imMJXvr-kxPXvrCb95CbSj8JykKNm50GXW1rYCGBdm6EhZ5azMjrXPkP1VMBnyBOBCdwwB-258ONVu9Rflucd6vcb_vy20y8LAzwj1q5VhY_upPIjYA02KGD8ZP8D7FG3Y_-F6JQ',
  midCenturyDining:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuDRYEje2MoKccE3VOTMjwsJJIWwcLdwjoV1-x-MjZ7H8cHlA3WWSYfGRbtuxbGvPjvo02uG3uGmeb_ZsalZR9_wMv_LzXGq4VgfvFe-ZkW6M5oa283_dv2EdkZYd-afwFURlnfXx4nh9dWSIiifURK-i0ieZ3tJ4ACV_fslSnQ3Cf2btdHczO_87u_TP0ZIgTOwysIyDgbHtvTuaHWSWJcNvnAz83OPgzUKONNZgkn2',
  scandiKitchen:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuBsxY4v2yNzsL7DgH5M_72HQc8RSf7vU8Xav0IHG9kDBsYPVM3pmi1BsmzlB9LprRNcJ8JjGNsMPYK9o_kmvYffI2SCA4NDjHpxwbU7bNtJBcBcgOnYLHseRYzHJk0T_NqHPruQtUz9x0D57XRftmjUUT_4Y0tt7TgQKYtwf3yDC9r3OZbVT3HmmnLmdlF5C4PBu-CnzZTLGiSifqQa8zJZLJO-EuZRrh1Ly0oJz2zu',
  sunroomAtrium:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuCFHxdewDBpLLySufWtBy6GXJIH5jK7CC-SJzOqorC9DlRjIDRyZ0TOf9hZ4OMraicm4jKvvMVsrhF3KWfQoczXmLwsZsmi0NvHeLfBpW-7NrRyTPDC2Nh36MKhqSBBONAD8dV8cJjQYTV6Qy-18DgrlARnjQqDYqfNdHVaNFdn-an79SOK-sR2I3NMETvIEvKFcqYnWy8TK0IIU0ebvRbSbQ9LVLLOTy-N_l0tUnjS',
  bedroomLoft:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuD--HY5tipeoK95ixA6_jdKN2JupXDUmpKiZhyd3q0GvHe8R624Li0uTex4SC0A_qkAdKhY75kaeL86vvj0w1JQ0MAcsz_sHBlV4Ki42tWBwhIsLVegSpXWyz0_fqErUs6JVkIWj_IFrjC7B0QUOlc_Rr93VFeYFy9w5bkjiOMazO9P0SWrIKnhrhkpiuLn58Nro_CXp1gz6nT9XCMtU7VEvRSjDC9Ga6CWzsJqCFXu',
  scanPreviewLiving:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuCX6B_WnZudQ8b9LSssxb-WnUiA9SCxcRpTLHE9kxXGfkGhzWnkNQnKVsv4R26lp3AnqRDTZwsylzsSj0VaMkyi5DuMtgRgUSvcUHLuU3ZZV5ElrIzb_wSTquI6MoMhGCg3t9tLXAreVPoj6iRPzIAz3GtqRRzR_ADbdPwBLFx0wku6UzUAIYS36QiwdymsLDjA6ZrFAfVYgZcQLHlKZG-KTiNkqp6tr6BK7RKOkuKr',
  studioAfterRender:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuAkXpwlABQafhZgtmR6vl3mEM-UMyzSSTj8Lwb3v1hsPBb5HZFuCS8cLUguwGorP2HwUoGDJwlob-JZLE2nf1nKyk1FGR2f44RlLfdHON6d-r7I1H7TPRnoCHDvsDVCWyHs-Vmpxb_FOqyHuM1Q6MBGM31OqY2VNU0MFEFsuuq-5_JCfvisT7S_hyqP0XHqdAu6fKncVQ4hqKWZwMoBm1ICpgpl4BqtZS0yM-a20H1G',
  studioBeforeRender:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuCFJ78HOvLeyamV7dOPZ5PhOuJAVJozyI0CEP2gX4frsp7En1GSOSeJ093t2YHS-w1jSiCvbnV6WR9ORQaVbGcvfVtsiW_o3Cg1S_9RiWuL92wUCG7m_qZQ4yzy4C2hcLxkLksTlx_pHvS4NptsAEqTXIlTdYv4XJqk5t5F2Y1AjYF3cwLRh-qI5LXxJCzJC4QX4VcKPCfrf6srt2ara4-6PMzfvD2Wg4_CEVqQME-L',
  armchairFocus:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuAlL9H4xrvsaDBmhxLu4o9EGshG45AVhWDvMS0RyMLOjnKhYFOLdZ1NGAfOe38e3MyPuxy3pPr52NyIFayzZu9xPB6uiKxLBJruwUwO8aQYTfhY4u65kvNpKRURWQEEuKUlI-6ME-n5sUhFwdf-1pGbfAicDiJ17d_LIcwof52CCWw6m1z8beK60wWqum-BxCbkddKTCMNFJt-H0L0w-kZ1e_JxS531eKJm9EVtm6gm',
  cognacPreview:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuApU5dzg-2QJlZGnJVJ0GxUiMtRlEcqSgRaKZh-UUqyO3jLBxm5S0pM0RNCMY0K7Dj9uB9ouWsfQDY9ZR_LyUmya4GZITurByCvAD1PJxZGWJ0e8hZh4pPe5sNy8SY69rCQOm3GyMKbsFvCSdAUDqEHXaR2W7qmMXcFHBg5oytwSyYZk6Qtz6vr-eAyzJ_1-DijM92LjDERqKJy-j0mVcR5q5VevaqQ_ahoazJeD3s-',
  loginShowcase:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuBRJRmlkoPkZBWZGJ9kWHz41PZbKV6HoDTKp7ta7XhMiFAtGJYtktUtzPeXaCi6qBJe2y85Ffh8QoRXFNZlPwxYJjhJBGIGylE_h6km2jG5LKB9Rr5kZtrijv3b5bD45WeZ4VvGTjjhP7Ksns_NbAt4KFVYHg0udfURNxaV7KiE5xfOOwFfc8Aw95BuC7JmjXi7WCeCY4ZHFrG9RwApD5KZdLRYR_qmUO1DtcBsZ95-',
  signupShowcase:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuDAp9fXkd3rHQnB2i6tq3p74HcYmqaEUVEz0jwRaKe-z1g22nfYgFBFw-Z6jPzp3LpsJVdHR_dfui0Ru-SPxGLbbRO0418f7M6sn7Y6v5b_ybHRunPf0o2XpigCcrS-bNjDHlU50mo9QtRXasn2ms60njU4nTu_yrIVdlDalULHJPIzAizMJbeLPQDdbOHmEWKl9i67994kcdvRv-zbiZm_PuSiXNn6lfAcxQTYZ1rV',
  forgotShowcase:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuAcjBPsJhnJsfCCt6vcB6veeapXetLcb_wvYsShlIUvT-JBEFj_hUWuzWsHvdb6QEDE6MtFAFqwD21KBT4xkos4-xqrsGLaOYQ0leaKN0k-AfwcReNnlGt7HX_9SVgwsuDBdi-LdkgNxLWM4giYtwcVUrOd3TMZtd1ZmXr9vuzTUouMeOzPPJbpX6F_Wb9NCwBQjA8PjczmRz-R7Xu4FnUapPhY4l5LG-uAlOHEO6s7',
  setPwdShowcase:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuCiJ5bhywlvNrN_MTKM7E1K-5Cpd-ep1T8Ej0MxC0krHbOwGHCnPvl8PvWWX0hZc2vqkopGd1DIixLGUhWu3bxXYmnkv9qrHR2AHB3YSGxZmDQV0N07AB2fs7SHm6OCewMlvEMK9suG7Q9Qi07VbNrpbGoPReJuOOTY2SwPUVzOMoHu9CEKxjxjTMB5alIhQoQ6R7dCmLzD4wVYRbCew966r8v3oXgNANpeWGw6bxyx',
  resetSuccessShowcase:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuBd2DSgw1AOjhXnW2eXEH851HfbGVjXW5g2v2vWLmhE6mhT3plgdn7-FblDf_2UvqqO6-zcBTfhPxnV1i9_f4mdA-pT6iEImoWo6lPSLnsXyr9QmEll8CYCrfl1NzBr22pfW1peQThRx3L5dCfVFiUPZ9jn1PaPkdgAI5XnJ4ycqFmwf5t5X7FgIHyG_AakC-j5goWmrfe2cQfFauhSQSWgBrpfBknBYzh2iY8OD26k',
};

export const INITIAL_USER: UserProfile = {
  id: 'usr-elena-01',
  fullName: 'Elena Rostova',
  email: 'elena.rostova@ateliernord.com',
  title: 'Atelier Principal',
  studioName: 'Atelier Nord Architecture',
  practiceFocus: 'Interior Architecture & Luxury Residential',
  role: 'Architect',
  avatarUrl: STITCH_IMAGES.avatarElena,
  licenseId: 'FR-78219',
  location: 'Paris, France (UTC+1)',
  memberSince: 'Oct 2023',
  primaryRig: 'LiDAR Studio Pro 60fps',
};

export const INITIAL_SETTINGS: AtelierSettings = {
  apiBaseUrl: '',
  defaultPoseEstimator: 'GLOMAP',
  defaultMaxResolution: 960,
};

export const INITIAL_PROJECTS: Project[] = [];
export const INITIAL_TASKS: Record<string, ReconstructionTask> = {};
