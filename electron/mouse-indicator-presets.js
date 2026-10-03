/**
 * Visual presets for the mouse indicator (find-your-cursor helper).
 * Each preset: id, name, group, shape, colors, size, animation.
 */

const SHAPES = [
  "ring",
  "double-ring",
  "cross",
  "target",
  "diamond",
  "square",
  "dots",
  "flare",
  "burst",
  "arrow",
];

const ANIMS = [
  "pulse",
  "flash",
  "spin",
  "breathe",
  "ripple",
  "orbit",
  "rainbow",
  "bounce",
  "strobe",
  "none",
];

const COLORS = [
  { id: "cyan", hex: "#00f6ff", name: "Cyan" },
  { id: "mint", hex: "#3ee0b0", name: "Mint" },
  { id: "lime", hex: "#b6ff3e", name: "Lime" },
  { id: "yellow", hex: "#ffe566", name: "Yellow" },
  { id: "orange", hex: "#ff9a3c", name: "Orange" },
  { id: "hot", hex: "#ff4d6d", name: "Hot Pink" },
  { id: "magenta", hex: "#ff3df2", name: "Magenta" },
  { id: "violet", hex: "#b388ff", name: "Violet" },
  { id: "blue", hex: "#4da3ff", name: "Blue" },
  { id: "white", hex: "#ffffff", name: "White" },
  { id: "red", hex: "#ff5555", name: "Red" },
  { id: "gold", hex: "#ffd76a", name: "Gold" },
];

function preset(id, name, group, shape, color, color2, size, thickness, glow, animate, flash) {
  // Keep graphics tight around the cursor so they fit the overlay window.
  return {
    id,
    name,
    group,
    shape,
    color,
    color2: color2 || color,
    size: Math.max(28, Math.round(size * 0.52)),
    thickness: Math.max(2, Math.round(thickness * 0.7)),
    glow: Math.max(8, Math.round(glow * 0.45)),
    animate,
    flash: Boolean(flash),
  };
}

const PRESETS = [
  // Bright rings
  preset("neon-cyan-ring", "Neon Cyan Ring", "Rings", "ring", "#00f6ff", "#ffffff", 78, 4, 22, "pulse", false),
  preset("mint-ring-flash", "Mint Flash Ring", "Rings", "ring", "#3ee0b0", "#e8fff6", 82, 5, 26, "flash", true),
  preset("lime-double", "Lime Double Ring", "Rings", "double-ring", "#b6ff3e", "#ffffff", 88, 3, 20, "ripple", false),
  preset("hot-pink-ring", "Hot Pink Ring", "Rings", "ring", "#ff4d6d", "#ffd0da", 80, 5, 28, "pulse", true),
  preset("violet-breathe", "Violet Breathe", "Rings", "ring", "#b388ff", "#ffffff", 76, 4, 24, "breathe", false),
  preset("white-strobe-ring", "White Strobe Ring", "Rings", "ring", "#ffffff", "#aef7ff", 90, 6, 30, "strobe", true),
  preset("orange-ripple", "Orange Ripple", "Rings", "double-ring", "#ff9a3c", "#ffe0b8", 86, 4, 22, "ripple", false),
  preset("blue-thick", "Thick Blue Ring", "Rings", "ring", "#4da3ff", "#d6ebff", 84, 7, 18, "pulse", false),
  preset("gold-ring-spin", "Gold Spin Ring", "Rings", "ring", "#ffd76a", "#fff4c8", 78, 4, 24, "spin", false),
  preset("red-alert-ring", "Red Alert Ring", "Rings", "double-ring", "#ff5555", "#ffffff", 92, 5, 32, "flash", true),

  // Targets / crosshairs
  preset("cyan-target", "Cyan Target", "Targets", "target", "#00f6ff", "#ffffff", 86, 3, 20, "pulse", false),
  preset("lime-cross", "Lime Crosshair", "Targets", "cross", "#b6ff3e", "#ffffff", 90, 3, 18, "none", false),
  preset("magenta-target", "Magenta Target", "Targets", "target", "#ff3df2", "#ffffff", 88, 4, 26, "flash", true),
  preset("white-cross-flash", "White Flash Cross", "Targets", "cross", "#ffffff", "#00f6ff", 94, 4, 28, "flash", true),
  preset("mint-target-spin", "Mint Spin Target", "Targets", "target", "#3ee0b0", "#ffffff", 82, 3, 20, "spin", false),
  preset("orange-cross", "Orange Crosshair", "Targets", "cross", "#ff9a3c", "#ffffff", 88, 3, 22, "breathe", false),
  preset("violet-target", "Violet Target", "Targets", "target", "#b388ff", "#ffffff", 84, 3, 24, "orbit", false),
  preset("red-cross-strobe", "Red Strobe Cross", "Targets", "cross", "#ff5555", "#ffffff", 96, 4, 30, "strobe", true),
  preset("blue-target-ripple", "Blue Ripple Target", "Targets", "target", "#4da3ff", "#ffffff", 90, 3, 22, "ripple", false),
  preset("gold-cross", "Gold Crosshair", "Targets", "cross", "#ffd76a", "#ffffff", 86, 3, 20, "pulse", false),

  // Shapes
  preset("cyan-diamond", "Cyan Diamond", "Shapes", "diamond", "#00f6ff", "#ffffff", 78, 4, 22, "spin", false),
  preset("mint-square", "Mint Square", "Shapes", "square", "#3ee0b0", "#ffffff", 72, 4, 18, "pulse", false),
  preset("hot-diamond-flash", "Hot Diamond Flash", "Shapes", "diamond", "#ff4d6d", "#ffffff", 80, 4, 26, "flash", true),
  preset("lime-square-bounce", "Lime Bounce Square", "Shapes", "square", "#b6ff3e", "#ffffff", 74, 4, 20, "bounce", false),
  preset("violet-diamond", "Violet Diamond", "Shapes", "diamond", "#b388ff", "#ffffff", 76, 4, 24, "orbit", false),
  preset("white-square-strobe", "White Strobe Square", "Shapes", "square", "#ffffff", "#00f6ff", 78, 5, 28, "strobe", true),
  preset("orange-diamond", "Orange Diamond", "Shapes", "diamond", "#ff9a3c", "#ffffff", 80, 4, 22, "breathe", false),
  preset("blue-square", "Blue Square", "Shapes", "square", "#4da3ff", "#ffffff", 70, 4, 18, "none", false),
  preset("magenta-diamond", "Magenta Diamond", "Shapes", "diamond", "#ff3df2", "#ffffff", 82, 4, 26, "spin", false),
  preset("gold-square-flash", "Gold Flash Square", "Shapes", "square", "#ffd76a", "#ffffff", 76, 4, 24, "flash", true),

  // Flares / bursts / dots
  preset("cyan-flare", "Cyan Flare", "Flares", "flare", "#00f6ff", "#ffffff", 100, 3, 34, "pulse", true),
  preset("mint-burst", "Mint Burst", "Flares", "burst", "#3ee0b0", "#ffffff", 96, 3, 30, "ripple", false),
  preset("hot-flare", "Hot Pink Flare", "Flares", "flare", "#ff4d6d", "#ffffff", 104, 3, 36, "flash", true),
  preset("lime-dots", "Lime Orbit Dots", "Flares", "dots", "#b6ff3e", "#ffffff", 88, 3, 20, "orbit", false),
  preset("violet-burst", "Violet Burst", "Flares", "burst", "#b388ff", "#ffffff", 98, 3, 32, "spin", false),
  preset("white-flare-strobe", "White Strobe Flare", "Flares", "flare", "#ffffff", "#ffd76a", 110, 3, 40, "strobe", true),
  preset("orange-dots", "Orange Orbit Dots", "Flares", "dots", "#ff9a3c", "#ffffff", 90, 3, 22, "orbit", false),
  preset("blue-burst-flash", "Blue Flash Burst", "Flares", "burst", "#4da3ff", "#ffffff", 100, 3, 34, "flash", true),
  preset("magenta-flare", "Magenta Flare", "Flares", "flare", "#ff3df2", "#ffffff", 102, 3, 36, "breathe", true),
  preset("gold-dots", "Gold Orbit Dots", "Flares", "dots", "#ffd76a", "#ffffff", 86, 3, 24, "orbit", false),

  // High-visibility / accessibility
  preset("hyper-white", "Hyper White Pulse", "High visibility", "double-ring", "#ffffff", "#00f6ff", 110, 6, 40, "pulse", true),
  preset("hyper-yellow", "Hyper Yellow Flash", "High visibility", "target", "#ffe566", "#ffffff", 108, 5, 38, "flash", true),
  preset("hyper-lime", "Hyper Lime Strobe", "High visibility", "cross", "#b6ff3e", "#ffffff", 112, 5, 36, "strobe", true),
  preset("hyper-cyan", "Hyper Cyan Ripple", "High visibility", "double-ring", "#00f6ff", "#ffffff", 106, 5, 36, "ripple", true),
  preset("hyper-magenta", "Hyper Magenta Bounce", "High visibility", "flare", "#ff3df2", "#ffffff", 114, 4, 42, "bounce", true),
  preset("hyper-red", "Hyper Red Alert", "High visibility", "burst", "#ff5555", "#ffffff", 116, 5, 42, "strobe", true),
  preset("hyper-mint", "Hyper Mint Glow", "High visibility", "ring", "#3ee0b0", "#ffffff", 100, 6, 34, "breathe", true),
  preset("hyper-orange", "Hyper Orange Target", "High visibility", "target", "#ff9a3c", "#ffffff", 108, 5, 38, "flash", true),
  preset("rainbow-ring", "Rainbow Spin Ring", "High visibility", "ring", "#00f6ff", "#ff3df2", 96, 5, 30, "rainbow", true),
  preset("rainbow-flare", "Rainbow Flare", "High visibility", "flare", "#ffe566", "#ff3df2", 112, 4, 40, "rainbow", true),

  // Arrows / pointer helpers
  preset("cyan-arrow", "Cyan Pointer", "Pointers", "arrow", "#00f6ff", "#ffffff", 92, 4, 22, "bounce", false),
  preset("mint-arrow", "Mint Pointer", "Pointers", "arrow", "#3ee0b0", "#ffffff", 90, 4, 20, "pulse", false),
  preset("hot-arrow-flash", "Hot Flash Pointer", "Pointers", "arrow", "#ff4d6d", "#ffffff", 94, 4, 28, "flash", true),
  preset("white-arrow", "White Pointer", "Pointers", "arrow", "#ffffff", "#00f6ff", 96, 4, 26, "breathe", false),
  preset("gold-arrow-strobe", "Gold Strobe Pointer", "Pointers", "arrow", "#ffd76a", "#ffffff", 98, 4, 30, "strobe", true),

  // Extra pack A — unique mixes
  preset("ice-ring", "Ice Blue Ring", "Extra", "ring", "#9adbff", "#ffffff", 70, 3, 18, "breathe", false),
  preset("coral-double", "Coral Double Ring", "Extra", "double-ring", "#ff7f6e", "#ffe2dc", 74, 3, 20, "ripple", false),
  preset("emerald-target", "Emerald Target", "Extra", "target", "#2ee59d", "#d8fff0", 72, 3, 18, "pulse", false),
  preset("sunset-flare", "Sunset Flare", "Extra", "flare", "#ff6b3d", "#ffd36a", 86, 3, 28, "breathe", true),
  preset("aqua-cross", "Aqua Crosshair", "Extra", "cross", "#26e0d2", "#ffffff", 76, 3, 16, "none", false),
  preset("lilac-diamond", "Lilac Diamond", "Extra", "diamond", "#c9a0ff", "#ffffff", 68, 3, 18, "spin", false),
  preset("steel-square", "Steel Square", "Extra", "square", "#a8c0d8", "#ffffff", 64, 3, 14, "pulse", false),
  preset("candy-burst", "Candy Burst", "Extra", "burst", "#ff6ad5", "#7afcff", 84, 3, 26, "spin", false),
  preset("jade-dots", "Jade Orbit Dots", "Extra", "dots", "#3dcf8e", "#ffffff", 72, 3, 16, "orbit", false),
  preset("amber-arrow", "Amber Pointer", "Extra", "arrow", "#ffbf47", "#fff1c8", 78, 3, 18, "bounce", false),
  preset("sky-ring-flash", "Sky Flash Ring", "Extra", "ring", "#5ec8ff", "#ffffff", 72, 4, 22, "flash", true),
  preset("rose-target", "Rose Target", "Extra", "target", "#ff6f91", "#ffffff", 74, 3, 20, "orbit", false),
  preset("chartreuse-cross", "Chartreuse Cross", "Extra", "cross", "#d4ff4f", "#ffffff", 78, 3, 18, "flash", true),
  preset("indigo-double", "Indigo Double Ring", "Extra", "double-ring", "#6b7cff", "#d8dcff", 76, 3, 20, "pulse", false),
  preset("peach-diamond", "Peach Diamond", "Extra", "diamond", "#ffb38a", "#ffffff", 70, 3, 18, "breathe", false),
  preset("teal-square-spin", "Teal Spin Square", "Extra", "square", "#20c9b0", "#ffffff", 66, 3, 16, "spin", false),
  preset("berry-flare", "Berry Flare", "Extra", "flare", "#d946a6", "#ffd0ef", 88, 3, 28, "pulse", true),
  preset("mint-ice-burst", "Mint Ice Burst", "Extra", "burst", "#7dffd4", "#e8fff9", 82, 3, 24, "ripple", false),
  preset("saffron-dots", "Saffron Orbit Dots", "Extra", "dots", "#ffb300", "#ffffff", 70, 3, 18, "orbit", false),
  preset("cobalt-arrow", "Cobalt Pointer", "Extra", "arrow", "#3f7cff", "#d6e6ff", 80, 3, 18, "pulse", false),
  preset("ghost-thin-ring", "Ghost Thin Ring", "Extra", "ring", "#e8f6f1", "#9bb5ad", 62, 2, 12, "breathe", false),
  preset("toxic-target", "Toxic Target", "Extra", "target", "#a8ff3e", "#f3ffd6", 76, 3, 22, "strobe", true),
  preset("crimson-cross", "Crimson Cross", "Extra", "cross", "#ff3b4a", "#ffffff", 80, 3, 20, "strobe", true),
  preset("ocean-double", "Ocean Double Ring", "Extra", "double-ring", "#1ec8ff", "#7dffe6", 78, 3, 22, "ripple", false),
  preset("plum-diamond", "Plum Diamond", "Extra", "diamond", "#b45cff", "#f0dfff", 72, 3, 20, "orbit", false),

  // Extra pack B — more unique looks
  preset("neon-pair-ring", "Neon Pair Ring", "Extra", "ring", "#39ff14", "#ff00e5", 74, 4, 24, "rainbow", true),
  preset("frost-square", "Frost Square", "Extra", "square", "#c8e7ff", "#ffffff", 62, 2, 12, "breathe", false),
  preset("lava-flare", "Lava Flare", "Extra", "flare", "#ff3b1f", "#ffb347", 90, 3, 30, "flash", true),
  preset("plasma-burst", "Plasma Burst", "Extra", "burst", "#7a5cff", "#00f6ff", 86, 3, 26, "spin", false),
  preset("honey-dots", "Honey Orbit Dots", "Extra", "dots", "#ffcc33", "#fff4c2", 68, 3, 16, "orbit", false),
  preset("violet-arrow-flash", "Violet Flash Pointer", "Extra", "arrow", "#a678ff", "#ffffff", 82, 3, 20, "flash", true),
  preset("sea-target", "Seafoam Target", "Extra", "target", "#5dffc8", "#ffffff", 70, 3, 16, "none", false),
  preset("ruby-ring", "Ruby Ring", "Extra", "ring", "#ff2e63", "#ffd0db", 72, 4, 22, "pulse", false),
  preset("ultraviolet-cross", "Ultraviolet Cross", "Extra", "cross", "#8b5cff", "#e8dfff", 78, 3, 20, "rainbow", true),
  preset("bronze-diamond", "Bronze Diamond", "Extra", "diamond", "#d4a574", "#ffe8c8", 70, 3, 16, "spin", false),
  preset("electric-double", "Electric Double", "Extra", "double-ring", "#00ffc3", "#ffe600", 80, 3, 24, "strobe", true),
  preset("fog-flare", "Fog Flare", "Extra", "flare", "#d7e4ea", "#ffffff", 84, 3, 20, "breathe", false),
  preset("punch-burst", "Punch Burst", "Extra", "burst", "#ff4d6d", "#ffd166", 88, 3, 28, "bounce", true),
  preset("spruce-dots", "Spruce Orbit Dots", "Extra", "dots", "#3aa675", "#d8fff0", 70, 3, 14, "orbit", false),
  preset("ink-arrow", "Ink Pointer", "Extra", "arrow", "#6d7cff", "#dfe4ff", 78, 3, 16, "none", false),
  preset("solar-target", "Solar Target", "Extra", "target", "#ffd166", "#ffffff", 76, 4, 24, "pulse", true),
  preset("night-ring", "Night Glow Ring", "Extra", "ring", "#5b8def", "#b8d4ff", 68, 3, 18, "breathe", false),
  preset("mango-square", "Mango Square", "Extra", "square", "#ffb347", "#fff0d6", 66, 3, 16, "bounce", false),
  preset("orchid-cross", "Orchid Cross", "Extra", "cross", "#e56bff", "#ffffff", 76, 3, 18, "orbit", false),
  preset("glacier-double", "Glacier Double Ring", "Extra", "double-ring", "#a8e4ff", "#ffffff", 74, 2, 16, "ripple", false),
  preset("spark-flare", "Spark Flare", "Extra", "flare", "#fff36a", "#ff9a3c", 86, 3, 28, "strobe", true),
  preset("neon-blade-arrow", "Neon Blade Pointer", "Extra", "arrow", "#00f6ff", "#39ff14", 84, 3, 22, "flash", true),
  preset("comet-burst", "Comet Burst", "Extra", "burst", "#7afcff", "#ff6ad5", 90, 3, 28, "rainbow", true),
  preset("moss-diamond", "Moss Diamond", "Extra", "diamond", "#7bc96f", "#e8ffd8", 68, 3, 14, "pulse", false),
  preset("volt-target", "Volt Target", "Extra", "target", "#d6ff3e", "#ffffff", 78, 4, 22, "flash", true),
];
function getPreset(id) {
  const found = PRESETS.find((p) => p.id === id);
  return found || PRESETS[0];
}

function listPresets() {
  return PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    group: p.group,
    color: p.color,
    color2: p.color2,
    shape: p.shape,
    animate: p.animate,
  }));
}

module.exports = {
  PRESETS,
  SHAPES,
  ANIMS,
  COLORS,
  getPreset,
  listPresets,
  DEFAULT_PRESET_ID: PRESETS[0].id,
};
