#!/usr/bin/env python3
"""Generate small and large CSV fixtures with parser edge cases."""

import csv
import os
from collections.abc import Callable, Sequence
from pathlib import Path


DEFAULT_BIG_SIZE_BYTES = 500 * 1024 * 1024
CHECK_INTERVAL_ROWS = 500
OUTPUT_DIR = Path(__file__).resolve().parent


SmallFileSpec = tuple[str, list[list[str]]]
BigRowFactory = Callable[[int], list[str]]
BigFileSpec = tuple[str, list[str], BigRowFactory]


SMALL_FILES: list[SmallFileSpec] = [
    (
        "sample-data.csv",
        [
            ["id", "name", "note", "city", "amount", "flag"],
            [
                "1",
                "Alice",
                'Simple quoted text with a comma, and a "quote".',
                "New York",
                "123.45",
                "true",
            ],
            [
                "2",
                "李雷",
                "Unicode row with 汉字, emoji 😀, and accents café naïve.",
                "北京",
                "0",
                "false",
            ],
            [
                "3",
                "Zoë",
                "Embedded newline inside a quoted field\nsecond line of the note",
                "München",
                "-42.00",
                "",
            ],
            [
                "4",
                "O'Connor",
                "=SUM(1,2) should stay plain CSV text, not a formula.",
                "Dublin",
                "1,234.56",
                "TRUE",
            ],
        ],
    ),
    (
        "small-ragged-unicode.csv",
        [
            ["alpha", "beta", "gamma", "delta"],
            ["short", "two columns only"],
            ["extra", "columns", "beyond", "the", "header", "末尾"],
            ["", "", "blank-leading-fields", ""],
            ["quoted", 'He said "hello"', "comma,value", "line\rbreak"],
            ["русский", "العربية", "עברית", "हिन्दी"],
            [],
        ],
    ),
]


def wide_edge_row(row_number: int) -> list[str]:
    return [
        f"wide-{row_number:09d}",
        "Title with comma, quote, and newline coverage",
        'Description with "quoted" text, commas, and CSV punctuation.',
        (
            "This wide placeholder summary is intentionally verbose so each row "
            "is large enough to exercise scrolling, parsing, wrapping, and "
            "virtualized rendering."
        ),
        "Renée O'Connor",
        "renee@example.com",
        "Placeholder Organization",
        "国际化",
        "active",
        "2026-01-01T00:00:00.000Z",
        "2026-01-02T00:00:00.000Z",
        "placeholder,csv,sample,emoji-😀",
        (
            "Paragraph one with repeated descriptive text for testing.\n"
            "Paragraph two includes an embedded newline inside a quoted field.\n"
            "Paragraph three includes commas, quotes, and tabs\tinside text."
        ),
        "Internal note, external note, review note, QA note.",
        "0.987654321",
    ]


def unicode_ragged_row(row_number: int) -> list[str]:
    base = [
        f"unicode-{row_number:09d}",
        ["東京", "München", "São Paulo", "Zürich"][row_number % 4],
        ["こんにちは", "mañana", "добро", "مرحبا"][row_number % 4],
        'A value with "quotes", commas, and emoji 🚀.',
        "" if row_number % 7 == 0 else f"value-{row_number}",
    ]

    if row_number % 11 == 0:
        return base[:3]

    if row_number % 13 == 0:
        return [
            *base,
            "extra column",
            "tail value with newline\nand carriage\rreturn",
        ]

    return base


def long_cell_row(row_number: int) -> list[str]:
    repeated = " | ".join(
        [
            "long text with comma, quote, and unicode",
            '"quoted segment"',
            "café",
            "数据",
            "🙂",
        ]
        * 8
    )
    return [
        f"long-{row_number:09d}",
        repeated,
        "line one\nline two\nline three",
        "'=HYPERLINK(\"https://example.com\", \"plain text\")",
        " leading and trailing spaces ",
        str(row_number % 10_000),
    ]


BIG_FILES: list[BigFileSpec] = [
    (
        "large-placeholder.csv",
        [
            "id",
            "title",
            "description",
            "summary",
            "author_name",
            "author_email",
            "organization",
            "category",
            "status",
            "created_at",
            "updated_at",
            "tags",
            "body",
            "notes",
            "score",
        ],
        wide_edge_row,
    ),
    (
        "large-unicode-ragged.csv",
        ["id", "city", "greeting", "note", "optional_value"],
        unicode_ragged_row,
    ),
    (
        "large-long-cells.csv",
        ["id", "long_text", "multiline", "formula_like", "spaces", "bucket"],
        long_cell_row,
    ),
]


def get_big_size_bytes() -> int:
    raw_value = os.environ.get("QUICK_CSV_BIG_SIZE_MB")
    if raw_value is None:
        return DEFAULT_BIG_SIZE_BYTES

    try:
        value = float(raw_value)
    except ValueError as error:
        raise SystemExit("QUICK_CSV_BIG_SIZE_MB must be a number.") from error

    if value <= 0:
        raise SystemExit("QUICK_CSV_BIG_SIZE_MB must be greater than 0.")

    return int(value * 1024 * 1024)


def write_small_file(file_name: str, rows: Sequence[Sequence[str]]) -> None:
    output_path = OUTPUT_DIR / file_name
    with output_path.open("w", encoding="utf-8", newline="") as output_file:
        writer = csv.writer(output_file)
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {output_path}")


def write_big_file(
    file_name: str,
    header: Sequence[str],
    row_factory: BigRowFactory,
    target_size_bytes: int,
) -> None:
    output_path = OUTPUT_DIR / file_name
    row_count = 0

    with output_path.open("w", encoding="utf-8", newline="") as output_file:
        writer = csv.writer(output_file)
        writer.writerow(header)

        while True:
            for _ in range(CHECK_INTERVAL_ROWS):
                row_count += 1
                writer.writerow(row_factory(row_count))

            output_file.flush()
            if output_path.stat().st_size >= target_size_bytes:
                break

    size_mb = output_path.stat().st_size / 1024 / 1024
    print(f"Wrote {row_count} data rows to {output_path} ({size_mb:.1f} MB)")


def main() -> None:
    big_size_bytes = get_big_size_bytes()

    for file_name, rows in SMALL_FILES:
        write_small_file(file_name, rows)

    for file_name, header, row_factory in BIG_FILES:
        write_big_file(file_name, header, row_factory, big_size_bytes)


if __name__ == "__main__":
    main()
