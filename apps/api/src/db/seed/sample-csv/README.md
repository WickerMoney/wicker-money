# Sample CSVs for the import-csv plugin

These are hand-built inputs for manually driving the real CSV importer
through the UI — they are not wired into anything `pnpm seed` creates
automatically. Sign in as `hero@seed.wickermoney.test`, go to Import, and try
each one against the "Everyday Checking" or "Rewards Credit Card" account.

| File | Column mapping | Amount style | Date format | What it exercises |
|---|---|---|---|---|
| `signed-checking.csv` | Transaction Date / Description / Amount | signed | MM/DD/YYYY | The default, easy case |
| `split-debit-credit.csv` | Date / Description / Debit / Credit | split (two columns) | MM/DD/YYYY | An export that puts money in and out in separate columns |
| `inverted-amex.csv` | Date / Description / Amount | signed, invert | MM/DD/YYYY | A card export where a charge is a *positive* number |
| `dd-mm-dates-with-issues.csv` | Date / Description / Amount | signed | DD/MM/YYYY | Day/month order, a duplicate row, and one malformed row |

`dd-mm-dates-with-issues.csv` is the one worth reading before you import it:
row 4 repeats row 3 verbatim (to check the importer flags or skips a true
duplicate), and the last row has a non-numeric amount (to check that one bad
row is flagged rather than failing the whole file).
