"""펫 시트(pets/sprite.png)에 새 동작 줄을 붙이는 도구.

투명 배경 PNG(한 줄 또는 격자)에서 프레임을 잘라, 기존 우사기와 같은 크기·바닥선으로 맞춘 뒤
시트 아래에 줄을 붙인다. 원래 시트는 pets/sprite-before-<이름>.png 로 먼저 백업한다.

필요: Python 3 + Pillow, numpy, scipy   (pip install pillow numpy scipy)

사용 예 (UsagiPet 폴더에서):
  # 미리보기만 (시트는 그대로)
  python dev/sprite-tools/add_rows.py 그림.png --name eat --dry-run
  # 시트에 붙이기
  python dev/sprite-tools/add_rows.py 그림.png --name eat
  # 5x5 격자, 서 있는 프레임 번호를 직접 지정해 크기 맞추기
  python dev/sprite-tools/add_rows.py 격자.png --name sway --per-row 5 --stand 2,4,6

시트 규칙 (main.js sliceSheet 가 자동으로 읽는 형식):
  - 칸 192x208, 프레임 가운데 x = 96 + 192*i, 발바닥(바닥선) = 줄 위쪽 + 196
  - 서 있는 몸 높이(귀 포함) 약 153px — 쉬기 그림과 같은 배율이 되도록
  - 프레임끼리 가로로 떨어져 있어야 한다 (칸 밖으로 나가면 오류)
  - 붙인 줄 번호(0부터)는 끝에 출력된다. main.js DEFAULT_SPRITE_OPTIONS.rows 나 pets/sprite.json 에 연결한다.
"""
import argparse
import os
import shutil
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

CELL_W, CELL_H, BASE, STAND_H = 192, 208, 196, 153


def runs(profile, min_gap):
    on = np.where(profile)[0]
    out = []
    if not len(on):
        return out
    s = p = on[0]
    for v in on[1:]:
        if v - p > min_gap:
            out.append((s, p + 1))
            s = v
        p = v
    out.append((s, p + 1))
    return out


def clean(crop):
    """가장 큰 덩어리(몸)와 그 근처 조각만 남기고 떨어진 티끌은 지운다."""
    a = np.array(crop)
    m = a[..., 3] >= 24
    lab, n = ndimage.label(m, structure=np.ones((3, 3)))
    if n == 0:
        return None
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    big = int(np.argmax(sizes)) + 1
    ys, xs = np.where(lab == big)
    x0, x1, y0, y1 = xs.min() - 12, xs.max() + 12, ys.min() - 12, ys.max() + 12
    keep = np.zeros_like(m)
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None:
            continue
        near = sl[1].start <= x1 and sl[1].stop >= x0 and sl[0].start <= y1 and sl[0].stop >= y0
        if i == big or (sizes[i - 1] >= 15 and near):
            keep |= lab == i
    a[..., 3] = np.where(keep, a[..., 3], 0)
    out = Image.fromarray(a)
    return out.crop(out.getbbox())


def cut_frames(img, col_gap, row_gap):
    a = np.array(img)
    frames = []
    for y0, y1 in runs((a[..., 3] >= 24).any(1), row_gap):
        cols = (a[y0:y1, :, 3] >= 24).any(0)
        for x0, x1 in runs(cols, col_gap):
            f = clean(img.crop((x0, y0, x1, y1)))
            if f is not None and f.width * f.height > 400:
                frames.append(f)
    return frames


def count_rows(sheet):
    """main.js sliceSheet 와 같은 방식(2px 틈까지 한 덩어리, 세로로 겹치면 같은 줄)으로 시트의 줄 수를 센다."""
    m = np.array(sheet)[..., 3] >= 16
    lab, n = ndimage.label(ndimage.binary_dilation(m, np.ones((5, 5))), structure=np.ones((3, 3)))
    spans = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is not None and (m[sl] & (lab[sl] == i)).sum() > 40:
            spans.append([sl[0].start, sl[0].stop])
    spans.sort()
    rows = []
    for top, bottom in spans:
        if rows and top < rows[-1][1]:
            rows[-1][1] = max(rows[-1][1], bottom)
        else:
            rows.append([top, bottom])
    return len(rows)


def body_center(a):
    cnt = (a[..., 3] >= 24).sum(0)
    cols = np.where(cnt >= cnt.max() * 0.45)[0]
    return (cols.min() + cols.max()) / 2


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('image', help='투명 배경 PNG (프레임이 한 줄 또는 격자로 놓인 그림)')
    ap.add_argument('--name', required=True, help='백업·미리보기 파일 이름에 쓸 동작 이름 (예: eat)')
    ap.add_argument('--sheet', default='pets/sprite.png')
    ap.add_argument('--per-row', type=int, default=8, help='시트 한 줄에 넣을 프레임 수 (최대 8)')
    ap.add_argument('--stand', default='', help='크기 기준으로 쓸 "서 있는" 프레임 번호 (쉼표). 비우면 높이 중앙값')
    ap.add_argument('--expect', type=int, default=0, help='기대하는 프레임 수 (다르면 멈춤)')
    ap.add_argument('--col-gap', type=int, default=8, help='프레임 사이 최소 빈 칸(px). 붙어 있으면 줄이기')
    ap.add_argument('--row-gap', type=int, default=25)
    ap.add_argument('--dry-run', action='store_true', help='시트를 바꾸지 않고 미리보기만 만든다')
    args = ap.parse_args()

    img = Image.open(args.image).convert('RGBA')
    a = np.array(img)
    a[..., 3] = np.where(a[..., 3] >= 200, 255, a[..., 3])  # 살짝 비치는 몸은 불투명하게
    img = Image.fromarray(a)

    frames = cut_frames(img, args.col_gap, args.row_gap)
    print(f'프레임 {len(frames)}개:', [f.size for f in frames])
    if args.expect and len(frames) != args.expect:
        sys.exit(f'기대한 {args.expect}개와 다릅니다. --col-gap / --row-gap 을 조정하세요.')
    if not frames:
        sys.exit('프레임을 찾지 못했습니다 (투명 배경인지 확인).')

    stand = [int(x) for x in args.stand.split(',') if x.strip()]
    ref = np.median([frames[i].height for i in stand]) if stand else np.median([f.height for f in frames])
    scale = STAND_H / ref
    print(f'배율 {scale:.4f} (기준 높이 {ref:.0f}px → {STAND_H}px)')

    sheet = Image.open(args.sheet).convert('RGBA')
    SW, SH = sheet.size
    per = max(1, min(8, args.per_row))
    groups = [frames[i:i + per] for i in range(0, len(frames), per)]
    new = Image.new('RGBA', (SW, SH + len(groups) * CELL_H), (0, 0, 0, 0))
    new.paste(sheet, (0, 0))
    for r, group in enumerate(groups):
        for i, f in enumerate(group):
            g = f.resize((max(1, round(f.width * scale)), max(1, round(f.height * scale))), Image.LANCZOS)
            x = round(96 + CELL_W * i - body_center(np.array(g)))
            y = SH + r * CELL_H + BASE - g.height
            if x < CELL_W * i + 2 or x + g.width > CELL_W * (i + 1) - 2 or y < SH + r * CELL_H + 4:
                sys.exit(f'{r}줄 {i}번 프레임이 칸(192x208) 밖으로 나갑니다. --stand 로 배율을 다시 잡으세요.')
            new.alpha_composite(g, (x, y))

    first_new = count_rows(sheet)

    preview = f'dev/sprite-tools/preview-{args.name}.png'
    os.makedirs(os.path.dirname(preview), exist_ok=True)
    crop = new.crop((0, max(0, SH - CELL_H), SW, new.height))
    bg = Image.new('RGBA', crop.size, (235, 235, 235, 255))
    bg.alpha_composite(crop)
    bg.save(preview)
    print('미리보기:', preview)

    if args.dry_run:
        print('--dry-run: 시트는 바꾸지 않았습니다.')
        return
    backup = os.path.join(os.path.dirname(args.sheet), f'sprite-before-{args.name}.png')
    if not os.path.exists(backup):
        shutil.copy2(args.sheet, backup)
        print('백업:', backup)
    new.save(args.sheet)
    print(f'시트 저장: {args.sheet} {new.size}, 새 줄 {len(groups)}개 (프레임 {[len(g) for g in groups]})')
    print(f'새 줄 번호(0부터): {first_new} ~ {first_new + len(groups) - 1}')
    print('main.js DEFAULT_SPRITE_OPTIONS.rows 또는 pets/sprite.json 의 rows 에 이 번호를 연결하세요.')


if __name__ == '__main__':
    main()
