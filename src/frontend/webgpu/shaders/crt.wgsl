struct CrtUniforms {
    resolution: vec2<f32>,
    time: f32,
    curvature: f32,
    scanline_intensity: f32,
    bloom_strength: f32,
    chromatic_aberration: f32,
    phosphor_mask: f32,
};

@group(0) @binding(0) var<uniform> crt: CrtUniforms;
@group(0) @binding(1) var screen_tex: texture_2d<f32>;
@group(0) @binding(2) var screen_sampler: sampler;

@vertex
fn vs_fullscreen(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
    var pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0)
    );
    return vec4<f32>(pos[vid], 0.0, 1.0);
}

@fragment
fn fs_crt(@builtin(position) frag_coord: vec4<f32>) -> @location(0) vec4<f32> {
    let raw_uv = frag_coord.xy / crt.resolution;
    let color = textureSample(screen_tex, screen_sampler, raw_uv);
    return color;
}
