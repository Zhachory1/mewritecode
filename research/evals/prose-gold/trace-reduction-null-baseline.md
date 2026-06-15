---
id: trace-reduction-null-baseline
goldModel: gpt-4.1
promptVersion: prose-gold-v1
questionB64: VHJhY2Ugc3RlcCBieSBzdGVwIHdoYXQgaGFwcGVucyBpbiBvdXRwdXRSZWR1Y3Rpb25QY3Qob3V0cHV0T2ZmLCBvdXRwdXRGdWxsKSB3aGVuIG91dHB1dE9mZiBpcyAwOiB3aGF0IGRvZXMgaXQgcmV0dXJuLCB3aHksIGFuZCB3aGF0IHdvdWxkIGNhbGxlcnMgKHRoZSBhZ2dyZWdhdGUsIHRoZSB0YWJsZSkgZG8gd2l0aCB0aGF0IHZhbHVlPw==
---
When `outputReductionPct(outputOff, outputFull)` is called with `outputOff` equal to 0:

- The function checks if `outputOff` is 0.
- Since it is, the function immediately returns `null`.
- This return value signals that there is no reduction percentage to compute because the "off" output is empty or missing.
- Callers:
  - The aggregate logic detects the `null` and excludes this case from reduction calculations and averages, treating it as "no data" rather than zero reduction.
  - The table displays a dash or placeholder (not a numeric value) in the reduction column for this row, indicating that reduction is not applicable or cannot be computed for this entry.
