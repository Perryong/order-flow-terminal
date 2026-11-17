"""Generate an offline footprint and profile report from terminal tick exports."""
import argparse
import csv
import json
from collections import defaultdict
from decimal import Decimal, DecimalException
from html import escape
from pathlib import Path


def number(value):
    text = format(value, 'f')
    return text.rstrip('0').rstrip('.') if '.' in text else text


def positive(text):
    value = Decimal(text)
    if not value.is_finite() or value <= 0 or not -100 <= value.adjusted() <= 100:
        raise ValueError('expected a positive finite number')
    return value


def auto_bucket(price):
    target = price * Decimal('0.0001')
    scale = Decimal(10) ** target.adjusted()
    return next(scale * step for step in (5, 2, 1) if scale * step <= target)


def sides():
    return [Decimal(0), Decimal(0), Decimal(0)]


def aggregate(stream, bucket, bar_minutes):
    reader = csv.reader(stream)
    if next(reader, None) != ['time_ms', 'price', 'qty', 'sell']:
        raise ValueError('expected CSV header time_ms,price,qty,sell')
    bars = defaultdict(lambda: defaultdict(sides))
    profile = defaultdict(sides)
    periods = defaultdict(set)
    count = 0
    span = bar_minutes * 60000
    for row in reader:
        if not row:
            continue
        try:
            timestamp, price, qty, sell = row
            timestamp = int(timestamp)
            sell = sell.strip().lower()
            if not 0 <= timestamp <= 253402300799999 or sell not in ('0', 'false', '1', 'true', '', 'unknown'):
                raise ValueError('expected Unix milliseconds and a buy, sell or unknown side')
            price, qty = positive(price), positive(qty)
            if bucket is None:
                bucket = auto_bucket(price)
            level = price // bucket * bucket
        except (ValueError, DecimalException) as error:
            raise ValueError(f'line {reader.line_num}: invalid tick ({error})') from error
        bar = timestamp // span * span
        side = {'0': 1, 'false': 1, '1': 0, 'true': 0, '': 2, 'unknown': 2}[sell]
        bars[bar][level][side] += qty
        profile[level][side] += qty
        periods[level].add(timestamp // 1800000 * 1800000)
        count += 1
    if not count:
        raise ValueError('CSV contains no ticks')

    prices = sorted(profile, reverse=True)
    indexes = {p: i for i, p in enumerate(prices)}
    levels = []
    for p in prices:
        bid, ask, unknown = profile[p]
        level = [number(p), number(bid), number(ask), number(bid + ask + unknown),
                 number(ask - bid), sorted(periods[p])]
        if unknown:
            level.append(number(unknown))
        levels.append(level)
    footprints = []
    for timestamp, cells in sorted(bars.items()):
        values = []
        for p in sorted(cells, reverse=True):
            bid, ask, unknown = cells[p]
            value = [indexes[p], number(bid), number(ask), number(ask - bid)]
            if unknown:
                value.append(number(unknown))
            values.append(value)
        delta = sum(ask - bid for bid, ask, _ in cells.values())
        footprints.append([timestamp, values, number(delta)])
    bid, ask, unknown = map(sum, zip(*profile.values()))
    return dict(bucket=number(bucket), minutes=bar_minutes, count=count, levels=levels,
                bars=footprints, volume=number(bid + ask + unknown), unknown=number(unknown), delta=number(ask - bid))


def render(data, name):
    template = Path(__file__).with_name('report.html').read_text(encoding='utf-8')
    # Report data contains only normalized numbers and arrays. Insert the filename last.
    return template.replace('__REPORT_DATA__', json.dumps(data, separators=(',', ':'))).replace('__SOURCE_NAME__', escape(name))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path)
    parser.add_argument('-o', '--output', type=Path, help='default: <input stem>-report.html')
    parser.add_argument('--bucket', help='price increment per row (default: terminal automatic size)')
    parser.add_argument('--bar-minutes', type=int, default=1, help='footprint bar length (default: 1)')
    args = parser.parse_args()
    output = args.output or args.csv.with_name(args.csv.stem + '-report.html')
    try:
        if args.bar_minutes <= 0:
            raise ValueError('--bar-minutes must be positive')
        if output.resolve() == args.csv.resolve() or (output.exists() and output.samefile(args.csv)):
            raise ValueError('output would overwrite the tick CSV')
        bucket = positive(args.bucket) if args.bucket is not None else None
        with args.csv.open(encoding='utf-8-sig', newline='') as stream:
            data = aggregate(stream, bucket, args.bar_minutes)
        output.write_text(render(data, args.csv.name), encoding='utf-8')
    except (ValueError, DecimalException, OSError, csv.Error) as error:
        parser.exit(2, f'{parser.prog}: {error}\n')
    print(f"{output} ({data['count']:,} ticks, {len(data['bars']):,} bars)")


if __name__ == '__main__':
    main()
