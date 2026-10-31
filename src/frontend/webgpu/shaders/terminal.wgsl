struct Uniforms {
    viewport_size: vec2<f32>,
    cell_size: vec2<f32>,
    atlas_size: vec2<f32>,
    time: f32,
    sdf_range: f32,
    cursor_blink: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var atlas_tex: texture_2d<f32>;
@group(0) @binding(2) var atlas_sampler: sampler;

struct VertexInput {
    @location(0) quad_pos: vec2<f32>,
};

struct InstanceInput {
    @location(1) cell_pos: vec2<f32>,
    @location(2) cell_size: vec2<f32>,
    @location(3) uv_min: vec2<f32>,
    @location(4) uv_max: vec2<f32>,
    @location(5) fg_color: u32,
    @location(6) bg_color: u32,
    @location(7) flags: u32,
    @location(8) glyph_index: u32,
};

struct VertexOutput {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) quad_coord: vec2<f32>,
    @location(2) fg: vec4<f32>,
    @location(3) bg: vec4<f32>,
    @location(4) @interpolate(flat) flags: u32,
};

fn unpack_rgba(packed: u32) -> vec4<f32> {
    let r = f32((packed >> 24u) & 0xFFu) / 255.0;
    let g = f32((packed >> 16u) & 0xFFu) / 255.0;
    let b = f32((packed >> 8u) & 0xFFu) / 255.0;
    let a = f32(packed & 0xFFu) / 255.0;
    return vec4<f32>(r, g, b, a);
}

@vertex
fn vs_main(vert: VertexInput, inst: InstanceInput) -> VertexOutput {
    var out: VertexOutput;

    // Italic simulation: slant x based on y if flag 0x02 is set
    var p = vert.quad_pos;
    if ((inst.flags & 2u) != 0u) {
        p.x += (1.0 - p.y) * 0.2;
    }

    let pixel_pos = inst.cell_pos + p * inst.cell_size;
    let ndc_x = (pixel_pos.x / u.viewport_size.x) * 2.0 - 1.0;
    let ndc_y = 1.0 - (pixel_pos.y / u.viewport_size.y) * 2.0;

    out.clip_pos = vec4<f32>(ndc_x, ndc_y, 0.0, 1.0);
    out.uv = mix(inst.uv_min, inst.uv_max, vert.quad_pos);
    out.quad_coord = vert.quad_pos;
    out.fg = unpack_rgba(inst.fg_color);
    out.bg = unpack_rgba(inst.bg_color);
    out.flags = inst.flags;

    // Reverse/inverse flag (0x08)
    if ((inst.flags & 8u) != 0u) {
        let tmp = out.fg;
        out.fg = out.bg;
        out.bg = tmp;
    }

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    var color = in.bg;

    // Check if cell has glyph (uv_min != uv_max)
    if (in.uv.x != 0.0 || in.uv.y != 0.0) {
        let dist = textureSample(atlas_tex, atlas_sampler, in.uv).r;
        let afwidth = fwidth(dist) * 0.7071;
        let alpha = smoothstep(0.5 - afwidth, 0.5 + afwidth, dist);
        color = mix(color, in.fg, alpha * in.fg.a);
    }

    // Underline flag (0x04)
    if ((in.flags & 4u) != 0u && in.quad_coord.y >= 0.88 && in.quad_coord.y <= 0.94) {
        color = in.fg;
    }

    // Strikethrough flag (0x10)
    if ((in.flags & 16u) != 0u && in.quad_coord.y >= 0.48 && in.quad_coord.y <= 0.54) {
        color = in.fg;
    }

    // Active Cursor flag (0x20)
    if ((in.flags & 32u) != 0u && u.cursor_blink > 0.5) {
        color = mix(color, in.fg, 0.75);
    }

    return color;
}
