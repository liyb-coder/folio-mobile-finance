#!/usr/bin/env python3
"""Build transparent, performance-budgeted Folio desktop-pet assets."""

from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
PET_DIR = ROOT / "public" / "assets" / "pet"

ASSETS = (
    (
        PET_DIR / "folio-cat-actions-spritesheet.png",
        PET_DIR / "folio-cat-actions-spritesheet-transparent.png",
        3,
        2,
    ),
    (
        PET_DIR / "folio-cat-welcome-paw-spritesheet-v2.png",
        PET_DIR / "folio-cat-welcome-paw-spritesheet-v3-transparent.png",
        3,
        1,
    ),
    (
        PET_DIR / "folio-cat-rest-grooming-spritesheet.png",
        PET_DIR / "folio-cat-rest-grooming-spritesheet-transparent.png",
        3,
        1,
    ),
)


def median_channel(values: list[int]) -> int:
    values.sort()
    return values[len(values) // 2]


def sampled_background(cell: Image.Image) -> tuple[int, int, int]:
    width, height = cell.size
    inset = max(2, min(width, height) // 80)
    sample_size = max(4, min(width, height) // 40)
    samples: list[tuple[int, int, int]] = []
    for start_x, start_y in (
        (inset, inset),
        (width - inset - sample_size, inset),
        (inset, height - inset - sample_size),
        (width - inset - sample_size, height - inset - sample_size),
    ):
        for y in range(start_y, start_y + sample_size):
            for x in range(start_x, start_x + sample_size):
                samples.append(cell.getpixel((x, y))[:3])
    return tuple(median_channel([pixel[channel] for pixel in samples]) for channel in range(3))


def color_distance(pixel: tuple[int, ...], background: tuple[int, int, int]) -> int:
    return max(abs(pixel[channel] - background[channel]) for channel in range(3))


def connected_background(cell: Image.Image, background: tuple[int, int, int]) -> Image.Image:
    width, height = cell.size
    pixels = cell.load()
    mask = Image.new("L", cell.size, 0)
    mask_pixels = mask.load()
    queue: deque[tuple[int, int]] = deque()

    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(1, height - 1):
        queue.append((0, y))
        queue.append((width - 1, y))

    threshold = 34
    while queue:
        x, y = queue.popleft()
        if mask_pixels[x, y] != 0:
            continue
        if color_distance(pixels[x, y], background) > threshold:
            continue
        mask_pixels[x, y] = 255
        if x > 0:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))
    return mask


def transparent_cell(cell: Image.Image) -> Image.Image:
    rgba = cell.convert("RGBA")
    background = sampled_background(rgba)
    core = connected_background(rgba, background)
    fringe = core.filter(ImageFilter.MaxFilter(7))
    core_pixels = core.load()
    fringe_pixels = fringe.load()
    pixels = rgba.load()

    for y in range(rgba.height):
        for x in range(rgba.width):
            if core_pixels[x, y] == 255:
                pixels[x, y] = (*pixels[x, y][:3], 0)
                continue
            if fringe_pixels[x, y] == 0:
                continue
            distance = color_distance(pixels[x, y], background)
            if distance >= 62:
                continue
            normalized = max(0.0, min(1.0, (distance - 12) / 50))
            smooth = normalized * normalized * (3.0 - 2.0 * normalized)
            pixels[x, y] = (*pixels[x, y][:3], round(255 * smooth))
    return rgba


def extract_asset(source: Path, output: Path, columns: int, rows: int) -> Image.Image:
    source_image = Image.open(source).convert("RGBA")
    cell_width = source_image.width // columns
    cell_height = source_image.height // rows
    result = Image.new("RGBA", source_image.size, (0, 0, 0, 0))
    for row in range(rows):
        for column in range(columns):
            box = (
                column * cell_width,
                row * cell_height,
                (column + 1) * cell_width,
                (row + 1) * cell_height,
            )
            result.alpha_composite(
                transparent_cell(source_image.crop(box)),
                (column * cell_width, row * cell_height),
            )
    result.save(output, optimize=True)
    return result


def palette_frame(rgba: Image.Image) -> Image.Image:
    alpha = rgba.getchannel("A")
    palette_frame = rgba.convert("RGB").quantize(
        colors=255,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.FLOYDSTEINBERG,
    )
    palette = palette_frame.getpalette()[: 255 * 3]
    palette.extend([0, 0, 0])
    palette_frame.putpalette(palette)
    transparent = alpha.point(lambda value: 255 if value <= 72 else 0)
    palette_frame.paste(255, mask=transparent)
    palette_frame.info["transparency"] = 255
    palette_frame.info["disposal"] = 2
    return palette_frame


def split_cells(sheet: Image.Image, columns: int, rows: int) -> list[Image.Image]:
    cell_width = sheet.width // columns
    cell_height = sheet.height // rows
    return [
        sheet.crop(
            (
                column * cell_width,
                row * cell_height,
                (column + 1) * cell_width,
                (row + 1) * cell_height,
            ),
        )
        for row in range(rows)
        for column in range(columns)
    ]


def square_welcome_cell(cell: Image.Image) -> Image.Image:
    crop_size = min(cell.width, cell.height)
    left = max(0, (cell.width - crop_size) // 2)
    top = round(max(0, cell.height - crop_size) * 0.4)
    return cell.crop((left, top, left + crop_size, top + crop_size))


def motion_frame(
    cell: Image.Image,
    phase: float,
    *,
    rotate: float = 0.0,
    translate_x: float = 0.0,
    translate_y: float = 0.0,
    pulse: float = 0.0,
    size: int = 320,
) -> Image.Image:
    import math

    base_size = round(size * (0.94 + pulse * math.sin(phase * math.tau)))
    visual = cell.resize((base_size, base_size), Image.Resampling.LANCZOS)
    if rotate:
        visual = visual.rotate(
            rotate * math.sin(phase * math.tau),
            resample=Image.Resampling.BICUBIC,
            expand=False,
            fillcolor=(0, 0, 0, 0),
        )
    frame = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = round((size - visual.width) / 2 + translate_x * math.sin(phase * math.tau))
    y = round((size - visual.height) / 2 + translate_y * math.sin(phase * math.tau))
    frame.alpha_composite(visual, (x, y))
    return frame


def save_runtime_still(output: Path, cell: Image.Image, size: int = 192) -> Path:
    frame = motion_frame(cell, 0, size=size)
    frame.save(output, optimize=True)
    return output


def tween_cells(
    cells: list[Image.Image],
    sequence: list[int],
    *,
    inbetweens: int = 3,
    size: int = 192,
) -> list[Image.Image]:
    frames: list[Image.Image] = []
    for sequence_index, source_index in enumerate(sequence):
        next_index = sequence[(sequence_index + 1) % len(sequence)]
        source = motion_frame(cells[source_index], 0, size=size)
        target = motion_frame(cells[next_index], 0, size=size)
        for step in range(inbetweens):
            mix = step / inbetweens
            frames.append(Image.blend(source, target, mix))
    return frames


def save_animated_webp(
    output: Path,
    rgba_frames: list[Image.Image],
    *,
    duration: int | list[int],
) -> Path:
    rgba_frames[0].save(
        output,
        save_all=True,
        append_images=rgba_frames[1:],
        duration=duration,
        loop=0,
        lossless=False,
        quality=82,
        method=6,
        minimize_size=True,
    )
    return output


def save_gif(
    output: Path,
    rgba_frames: list[Image.Image],
    *,
    duration: int | list[int],
) -> Path:
    frames = [palette_frame(frame) for frame in rgba_frames]
    frames[0].save(
        output,
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        transparency=255,
        disposal=2,
        optimize=False,
    )
    return output


def build_runtime_gifs(
    action_sheet: Image.Image,
    welcome_sheet: Image.Image,
    rest_sheet: Image.Image,
) -> list[Path]:
    actions = split_cells(action_sheet, 3, 2)
    welcome = [square_welcome_cell(cell) for cell in split_cells(welcome_sheet, 3, 1)]
    rest = split_cells(rest_sheet, 3, 1)
    phases = [index / 7 for index in range(8)]
    states: dict[str, list[Image.Image]] = {
        "idle": [
            motion_frame(actions[0], phase, rotate=2.2, translate_y=2)
            for phase in phases
        ],
        "processing": [
            motion_frame(actions[2], phase, translate_y=5, pulse=0.008)
            for phase in phases
        ],
        "ready": [
            motion_frame(actions[4], phase, rotate=1.8, translate_y=2)
            for phase in phases
        ],
        "needs-input": [
            motion_frame(actions[3], phase, translate_x=5)
            for phase in phases
        ],
        "done": [
            motion_frame(actions[5], phase, translate_y=4, pulse=0.012)
            for phase in phases
        ],
        "welcome": [
            motion_frame(welcome[index], index / 3, translate_y=2)
            for index in [0, 1, 2, 1]
        ],
        "rest-grooming": [
            motion_frame(rest[index], index / 3)
            for index in [0, 1, 2, 1]
        ],
    }

    outputs: list[Path] = []
    for state, frames in states.items():
        output = PET_DIR / f"folio-cat-{state}-transparent.gif"
        duration: int | list[int] = 360
        if state == "welcome":
            duration = [360, 260, 360, 260]
        elif state == "rest-grooming":
            duration = [720, 620, 820, 520]
        outputs.append(save_gif(output, frames, duration=duration))

    preview_frames: list[Image.Image] = []
    for state in ["welcome", "idle", "processing", "ready", "needs-input", "done", "rest-grooming"]:
        preview_frames.extend(states[state])
    for preview_name in (
        "folio-cat-actions-preview.gif",
        "folio-cat-actions-preview-v2.gif",
        "folio-cat-actions-preview-v3.gif",
        "folio-cat-actions-preview-v4.gif",
    ):
        outputs.append(
            save_gif(
                PET_DIR / preview_name,
                preview_frames,
                duration=360,
            ),
        )
    return outputs


def build_performance_runtime_assets(
    action_sheet: Image.Image,
    welcome_sheet: Image.Image,
    rest_sheet: Image.Image,
) -> list[Path]:
    actions = split_cells(action_sheet, 3, 2)
    welcome = [square_welcome_cell(cell) for cell in split_cells(welcome_sheet, 3, 1)]
    rest = split_cells(rest_sheet, 3, 1)
    outputs = [
        save_runtime_still(PET_DIR / "folio-cat-idle-transparent.png", actions[0]),
        save_runtime_still(PET_DIR / "folio-cat-processing-transparent.png", actions[2]),
        save_runtime_still(PET_DIR / "folio-cat-ready-transparent.png", actions[4]),
        save_runtime_still(PET_DIR / "folio-cat-needs-input-transparent.png", actions[3]),
        save_runtime_still(PET_DIR / "folio-cat-done-transparent.png", actions[5]),
        save_runtime_still(PET_DIR / "folio-cat-welcome-static-transparent.png", welcome[1]),
        save_runtime_still(PET_DIR / "folio-cat-rest-grooming-static-transparent.png", rest[1]),
    ]
    outputs.append(
        save_animated_webp(
            PET_DIR / "folio-cat-welcome-transparent.webp",
            tween_cells(welcome, [0, 1, 2, 1], inbetweens=3),
            duration=90,
        ),
    )
    outputs.append(
        save_animated_webp(
            PET_DIR / "folio-cat-rest-grooming-transparent.webp",
            tween_cells(rest, [0, 1, 2, 1], inbetweens=3),
            duration=[170, 130, 110] * 4,
        ),
    )
    return outputs


def main() -> None:
    generated: dict[str, Image.Image] = {}
    for source, output, columns, rows in ASSETS:
        generated[output.name] = extract_asset(source, output, columns, rows)
    gif_paths = build_runtime_gifs(
        generated["folio-cat-actions-spritesheet-transparent.png"],
        generated["folio-cat-welcome-paw-spritesheet-v3-transparent.png"],
        generated["folio-cat-rest-grooming-spritesheet-transparent.png"],
    )
    runtime_paths = build_performance_runtime_assets(
        generated["folio-cat-actions-spritesheet-transparent.png"],
        generated["folio-cat-welcome-paw-spritesheet-v3-transparent.png"],
        generated["folio-cat-rest-grooming-spritesheet-transparent.png"],
    )
    for output in [asset[1] for asset in ASSETS] + gif_paths + runtime_paths:
        print(output.relative_to(ROOT))


if __name__ == "__main__":
    main()
