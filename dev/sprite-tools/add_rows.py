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
    ap.add_argument('--height', type=int, default=STAND_H,
                    help=f'맞출 서 있는 키 (기본 {STAND_H}). 머리가 큰 그림은 같은 키라도 훨씬 커 보이니 '
                         '--area 로 넓이를 맞추는 쪽이 낫다')
    ap.add_argument('--area', type=int, default=0,
                    help='--height 대신 보이는 넓이(px²)를 맞춘다. 기존 쉬기 그림은 약 9500')
    ap.add_argument('--scale', type=float, default=0,
                    help='배율을 직접 준다. 같은 그림체로 그린 원본을 여러 번 나눠 붙일 때 '
                         '(한 동작이 여러 그림에 걸칠 때) 반드시 같은 값을 써야 크기가 튀지 않는다')
    ap.add_argument('--expect', type=int, default=0, help='기대하는 프레임 수 (다르면 멈춤)')
    ap.add_argument('--col-gap', type=int, default=8, help='프레임 사이 최소 빈 칸(px). 붙어 있으면 줄이기')
    ap.add_argument('--row-gap', type=int, default=25)
    ap.add_argument('--fit', action='store_true',
                    help='귀를 위·옆으로 뻗는 동작처럼 192x208 칸을 넘는 그림용. 칸 너비를 시트너비/프레임수로, '
                         '칸 높이를 가장 큰 프레임에 맞춰 넓힌다 (바닥선은 칸 아래에서 12px 위로 유지)')
    ap.add_argument('--cell-w', type=int, default=0, help='칸 너비를 직접 지정 (기본 192, --fit 이면 자동)')
    ap.add_argument('--cell-h', type=int, default=0, help='칸 높이를 직접 지정 (기본 208, --fit 이면 자동)')
    ap.add_argument('--base', type=int, default=0, help='칸 위에서 바닥선까지 거리 (기본 196)')
    ap.add_argument('--replace', type=int, default=-1,
                    help='줄을 새로 붙이는 대신 그 줄(0부터)을 이 그림으로 바꾼다. 시트 높이와 다른 줄 번호는 그대로 유지된다')
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
    pick = [frames[i] for i in stand] if stand else frames
    if args.scale:
        scale = args.scale
        print(f'배율 {scale:.4f} (직접 지정, 서 있는 키 {np.median([f.height for f in pick]) * scale:.0f}px)')
    elif args.area:
        seen = np.median([(np.array(f)[..., 3] >= 24).sum() for f in pick])
        scale = (args.area / seen) ** 0.5
        print(f'배율 {scale:.4f} (기준 넓이 {seen:.0f}px² → {args.area}px², 서 있는 키 '
              f'{np.median([f.height for f in pick]) * scale:.0f}px)')
    else:
        ref = np.median([f.height for f in pick])
        scale = args.height / ref
        print(f'배율 {scale:.4f} (기준 높이 {ref:.0f}px → {args.height}px)')

    sheet = Image.open(args.sheet).convert('RGBA')
    SW, SH = sheet.size
    per = max(1, min(8, args.per_row))
    scaled = [f.resize((max(1, round(f.width * scale)), max(1, round(f.height * scale))), Image.LANCZOS) for f in frames]
    groups = [scaled[i:i + per] for i in range(0, len(scaled), per)]

    cell_w = args.cell_w or (SW // per if args.fit else CELL_W)
    cell_h = args.cell_h or (max(CELL_H, max(g.height for g in scaled) + 16) if args.fit else CELL_H)
    base = args.base or cell_h - (CELL_H - BASE)
    if (cell_w, cell_h, base) != (CELL_W, CELL_H, BASE):
        print(f'칸 {cell_w}x{cell_h}, 바닥선 {base} (기본 {CELL_W}x{CELL_H}, {BASE})')

    replacing = args.replace >= 0
    if replacing:
        if len(groups) != 1:
            sys.exit(f'--replace 는 한 줄짜리 그림만 바꿉니다 (지금 {len(groups)}줄 — --per-row 로 맞추세요)')
        if (args.replace + 1) * cell_h > SH:
            sys.exit(f'{args.replace}줄은 시트에 없습니다 (칸 {cell_h}px 기준 {SH // cell_h}줄)')
        new = sheet.copy()
        new.paste((0, 0, 0, 0), (0, args.replace * cell_h, SW, (args.replace + 1) * cell_h)) # 그 줄만 비운다
    else:
        new = Image.new('RGBA', (SW, SH + len(groups) * cell_h), (0, 0, 0, 0))
        new.paste(sheet, (0, 0))
    for r, group in enumerate(groups):
        top = args.replace * cell_h if replacing else SH + r * cell_h
        spans = []
        for i, g in enumerate(group):
            x = round(cell_w / 2 + cell_w * i - body_center(np.array(g)))
            y = top + base - g.height
            if x < cell_w * i + 2 or x + g.width > cell_w * (i + 1) - 2 or y < top + 4:
                sys.exit(f'{r}줄 {i}번 프레임이 칸({cell_w}x{cell_h}) 밖으로 나갑니다. '
                         '--fit 을 주거나 --per-row 를 줄이거나 --stand 로 배율을 다시 잡으세요.')
            new.alpha_composite(g, (x, y))
            spans.append((x, x + g.width))
        gaps = [spans[i + 1][0] - spans[i][1] for i in range(len(spans) - 1)]
        if gaps and min(gaps) < 10:
            sys.exit(f'{r}줄: 프레임 사이가 {min(gaps)}px 뿐입니다. main.js 는 6px 이내로 붙은 그림을 '
                     '한 프레임으로 합치므로 10px 이상 떨어져야 합니다. --per-row 를 줄이세요.')

    first_new = count_rows(sheet)

    preview = f'dev/sprite-tools/preview-{args.name}.png'
    os.makedirs(os.path.dirname(preview), exist_ok=True)
    # 바꾼 줄(또는 새로 붙인 줄)을 바로 위 줄과 함께 보여 준다 — 크기를 견주어 보라고
    crop = (new.crop((0, max(0, (args.replace - 1) * cell_h), SW, (args.replace + 1) * cell_h)) if replacing
            else new.crop((0, max(0, SH - cell_h), SW, new.height)))
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
    if replacing:
        print(f'시트 저장: {args.sheet} {new.size} (크기 그대로), {args.replace}줄을 {len(groups[0])}프레임으로 바꿨습니다.')
        print('줄 번호가 바뀌지 않으니 main.js 는 고칠 게 없습니다. 프레임 수가 달라졌으면 그 동작의 fps 를 확인하세요.')
        return
    print(f'시트 저장: {args.sheet} {new.size}, 새 줄 {len(groups)}개 (프레임 {[len(g) for g in groups]})')
    print(f'새 줄 번호(0부터): {first_new} ~ {first_new + len(groups) - 1}')
    print('main.js DEFAULT_SPRITE_OPTIONS.rows 또는 pets/sprite.json 의 rows 에 이 번호를 연결하세요.')


if __name__ == '__main__':
    main()
