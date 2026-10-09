#!/usr/bin/env python3
"""Export the maintained scholar roster into the static site data format."""

import argparse
import json
from datetime import date, datetime
from pathlib import Path

import openpyxl


HEADERS = [
    "surname",
    "name",
    "nameZh",
    "homepage",
    "route",
    "verification",
    "origin",
    "institution",
    "chinaTopic",
    "nberCount",
    "conferenceCodes",
]


def value(cell):
    if isinstance(cell, (datetime, date)):
        return cell.isoformat()
    return "" if cell is None else str(cell).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    workbook = openpyxl.load_workbook(args.input, read_only=True, data_only=True)
    sheet = workbook["统一名录"]
    scholars = []
    for row in sheet.iter_rows(min_row=6, values_only=True):
        values = [value(item) for item in row[:len(HEADERS)]]
        if not values[1]:
            continue
        scholars.append(dict(zip(HEADERS, values)))

    payload = {
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": "中国经济金融研究学者库｜扩展版（统一名录）",
        "scholars": scholars,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(scholars)} scholars to {args.output}")


if __name__ == "__main__":
    main()
