# Sample Data

This directory is for local CSV files used while manually testing Quick CSV
Viewer.

Run `generate_large_csv.py` to create two small CSV files and three large CSV
files. The large files default to 500 MB or more each. Generated `.csv` files
are ignored by Git so local test data does not get committed accidentally.

```sh
python3 sample-data/generate_large_csv.py
```

Generated files:

- `sample-data.csv`
- `small-ragged-unicode.csv`
- `large-placeholder.csv`
- `large-unicode-ragged.csv`
- `large-long-cells.csv`

For a quick local smoke test with smaller "large" files:

```sh
QUICK_CSV_BIG_SIZE_MB=5 python3 sample-data/generate_large_csv.py
```
