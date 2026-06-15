---
id: tradeoff-median-vs-mean
goldModel: gpt-4.1
promptVersion: prose-gold-v1
questionB64: SW4gYSBjb3N0LXBlci10YXNrIGJlbmNobWFyaywgd2hlbiBzaG91bGQgeW91IHJlcG9ydCB0aGUgTUVESUFOIGNvc3QgdnMgdGhlIE1FQU4gY29zdD8gRXhwbGFpbiB0aGUgdHJhZGUtb2ZmIGFuZCB3aGVuIGVhY2ggaXMgdGhlIHJpZ2h0IGhlYWRsaW5lLg==
---
Report the **median cost** when the distribution of task costs is skewed or contains outliers, as the median reflects the typical cost experienced for a single task and is robust to extreme values. Use the median as the headline when you want to represent the central tendency for a typical task, especially if a few tasks are much more expensive or cheaper than the rest, which would distort the mean.

Report the **mean cost** when the distribution is approximately symmetric and free of significant outliers, or when the total cost across all tasks is the primary concern. The mean reflects the average cost per task if all costs are pooled and divided evenly, and is appropriate when every task’s cost contributes equally to the overall budget or resource planning.

**Trade-off:**  
- The mean is sensitive to outliers and can be misleading if a small number of tasks are much more or less expensive than the rest.
- The median ignores magnitude of outliers and may underrepresent the impact of rare but costly tasks on total expenditure.

**Use median** when you want to communicate what most users or tasks will experience, or when cost variability is high and outliers are not representative of typical performance.

**Use mean** when total cost matters most, or when costs are uniformly distributed and outliers are not a concern. If reporting only one, choose the one that best matches the intended use: median for typical-case, mean for total or budgetary impact. In some cases, report both to fully characterize the cost distribution.
