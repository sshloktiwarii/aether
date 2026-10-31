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

// Radial barrel distortion
fn warp_uv(uv: vec2<f32>) -> vec2<f32> {
    if (crt.curvature <= 0.0) {
        return uv;
    }
    let dc = uv - vec2<f32>(0.5, 0.5);
    let dist_sq = dot(dc, dc);
    return uv + dc * (dist_sq * crt.curvature);
}

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
    let uv = warp_uv(raw_uv);

    // Bezel border clipping
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        return vec4<f32>(0.02, 0.02, 0.02, 1.0);
    }

    var color = textureSample(screen_tex, screen_sampler, uv);

    // Scanlines
    if (crt.scanline_intensity > 0.0) {
        let scanline = sin(uv.y * crt.resolution.y * 3.14159265);
        color = vec4<f32>(color.rgb * (1.0 - crt.scanline_intensity * (0.5 * (1.0 + scanline))), color.a);
    }

    // Aperture Grille / Phosphor Triad
    if (crt.phosphor_mask > 0.0) {
        let subpixel = floor(fract(frag_coord.x / 3.0) * 3.0);
        var mask = vec3<f32>(1.0);
        if (subpixel == 0.0) {
            mask = vec3<f32>(1.0, 1.0 - crt.phosphor_mask, 1.0 - crt.phosphor_mask);
        } else if (subpixel == 1.0) {
            mask = vec3<f32>(1.0 - crt.phosphor_mask, 1.0, 1.0 - crt.phosphor_mask);
        } else {
            mask = vec3<f32>(1.0 - crt.phosphor_mask, 1.0 - crt.phosphor_mask, 1.0);
        }
        color = vec4<f32>(color.rgb * mask, color.a);
    }

    // Vignette
    let edge_dist = uv * (1.0 - uv);
    let vignette = clamp(edge_dist.x * edge_dist.y * 30.0, 0.0, 1.0);
    color = vec4<f32>(color.rgb * vignette, color.a);

    return color;
}
