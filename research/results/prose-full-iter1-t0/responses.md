# Prose Microbench — responses (off vs candidate)

## code-explain-roles (code-explain / tune)

### prose=off (504 mean output tokens)

The `roles.ts` module defines a system for managing role tags in outbound calls made by an agent in a TypeScript codebase. Here's a breakdown of its components and design:

### Components

1. **Role Type**:
   - Defines a union type `Role` that can be one of four specific strings: `"plan"`, `"edit"`, `"explore"`, or `"verify"`. This restricts the roles that can be assigned to outbound calls.

2. **ROLES Constant**:
   - An array `ROLES` that holds the valid role strings. It is marked as `readonly` and uses `as const` to ensure that its type is inferred as a tuple of the specific strings rather than a general string array.

3. **isRole Function**:
   - A type guard function that checks if a given value is a valid `Role`. It verifies that the value is a string and checks if it exists in the `ROLES` array.

4. **RoleTagged Interface**:
   - An interface `RoleTagged` that represents an object containing a `role` of type `Role` and a `payload` of a generic type `T`. This structure allows for associating a specific role with any type of data.

5. **requireRole Function**:
   - A function that takes an object with optional `role` and `payload` properties. It checks if the `role` is valid using the `isRole` function. If the role is missing or invalid, it throws an error. If valid, it returns an object conforming to the `RoleTagged` interface.

### Design Summary

- **Purpose**: The module ensures that every outbound call from the agent has a valid role, enforcing a single role requirement. This is crucial for maintaining the integrity of the agent's operations and preventing errors in processing.

- **Type Safety**: By using TypeScript's type system, the module provides compile-time checks for valid roles, reducing runtime errors and improving code reliability.

- **Error Handling**: The `requireRole` function includes error handling to catch invalid or missing roles, making it clear when an outbound call does not meet the expected criteria.

- **Extensibility**: The design allows for easy addition of new roles by simply updating the `Role` type and `ROLES` array, making it flexible for future requirements.

Overall, this module is a well-structured approach to managing role-based behavior in outbound calls, ensuring that the agent operates within defined parameters.

### prose=full (468 mean output tokens)

The `roles.ts` module defines a system for managing role tags in outbound calls made by an agent in a TypeScript codebase. Here's a breakdown of its components and design:

### Components

1. **Role Type**:
   - Defines a union type `Role` with four possible string values: `"plan"`, `"edit"`, `"explore"`, and `"verify"`.
   - Each role represents a specific function or action that the agent can perform.

2. **ROLES Constant**:
   - An array `ROLES` that holds the valid role values.
   - Marked as `readonly` and uses `as const` to ensure the array is treated as a tuple, preserving the literal types of its elements.

3. **isRole Function**:
   - A type guard function that checks if a given value is a valid `Role`.
   - Returns `true` if the value is a string and is included in the `ROLES` array; otherwise, it returns `false`.

4. **RoleTagged Interface**:
   - A generic interface `RoleTagged` that requires a `role` of type `Role` and a `payload` of a generic type `T`.
   - This structure allows for associating a specific role with any type of data.

5. **requireRole Function**:
   - Accepts an object with optional `role` and required `payload`.
   - Validates the `role` using the `isRole` function.
   - Throws an error if the `role` is missing or invalid, ensuring that every outbound call has a valid role.
   - Returns an object conforming to the `RoleTagged` interface.

### Design Summary

- **Purpose**: Ensures that every outbound call from the agent has a valid role, preventing errors related to missing or incorrect roles.
- **Type Safety**: Utilizes TypeScript's type system to enforce role validity and structure, enhancing code reliability.
- **Error Handling**: Provides clear error messages for invalid role usage, aiding in debugging and testing.
- **Generics**: The use of generics in `RoleTagged` allows flexibility in the type of payload associated with each role, making the module adaptable to various data types.

Overall, the module is designed to enforce strict role management in outbound calls, ensuring that the agent operates within defined roles and maintains type safety throughout its operations.

## code-explain-honest-metrics (code-explain / tune)

### prose=off (522 mean output tokens)

The `honest-metrics.ts` file is designed for accounting and statistical reporting related to the performance and cost of a system, specifically in the context of a caveman ON-vs-OFF ablation study. Here's a breakdown of its functionality and design:

### Functionality

1. **Deterministic Behavior**: The module is a pure function module, meaning it does not perform any I/O operations, spawn processes, or rely on external dependencies. This ensures that the outputs are entirely determined by the inputs, making it suitable for unit testing.

2. **Cost Calculation**:
   - The cost of operations is computed using a shared pricing table through the `computeCost` function. This function calculates the dollar cost based on token usage (input, output, cache reads, and writes) for a specific model.
   - The pricing is structured such that it is always derived from a single source, ensuring consistency and accuracy in cost reporting.

3. **Usage Tracking**: The `Usage` interface tracks the number of tokens processed in various categories (input, output, cache reads, and writes). The `totalProcessed` function provides a supplementary metric for the total tokens processed, although it is not a primary metric.

4. **Run Records**: The `Run` interface captures details about each run, including the model used, the task performed, the seed for randomness, and the resolved status. This structure allows for comprehensive tracking of each execution's context and results.

5. **Statistical Helpers**: The file includes small statistical helper functions (not fully shown) that likely assist in analyzing the performance metrics collected during runs.

### Design Summary

- **Pure Module**: The design emphasizes purity and determinism, which is crucial for reproducibility in testing and analysis. The use of a seeded pseudo-random number generator (PRNG) further enhances this aspect.

- **Single Source of Truth**: By centralizing pricing information in a shared table, the design avoids discrepancies in cost calculations, ensuring that all components of the system refer to the same pricing data.

- **Structured Interfaces**: The use of TypeScript interfaces (`Usage`, `PricingRow`, `Run`) provides a clear structure for the data being handled, making the code more maintainable and understandable.

- **Focus on Metrics**: The module is tailored for metrics collection and reporting, making it a foundational component for performance analysis in the broader system.

Overall, `honest-metrics.ts` serves as a robust foundation for tracking and reporting the costs and performance of various models in a controlled and deterministic manner.

### prose=full (382 mean output tokens)

### Overview
`honest-metrics.ts` is a TypeScript module designed for accounting and statistical reporting related to the usage and costs of a system called "caveman." It focuses on providing deterministic metrics without any side effects or external dependencies.

### Key Features
- **Pure Module**: 
  - No I/O operations, process spawning, filesystem access, or reliance on external libraries.
  - Deterministic outputs based on inputs, ensuring reproducibility in tests through a seeded pseudo-random number generator (PRNG).

- **Cost Calculation**:
  - Costs are derived from a centralized pricing table, ensuring a single source of truth for pricing.
  - Functions like `computeCost` calculate costs based on token usage without returning dollar figures directly from parsers.

- **Usage Tracking**:
  - The `Usage` interface tracks different types of token usage: input, output, cache reads, and cache writes.
  - The `totalProcessed` function aggregates these metrics for diagnostic purposes.

- **Run Records**:
  - The `Run` interface captures details about each execution, including the model used, task, seed for randomness, and the resolved status.

### Design Summary
- **Deterministic and Pure**: The module is designed to be pure, meaning it does not produce side effects and its output is solely dependent on its inputs.
- **Centralized Pricing**: All cost calculations reference a shared pricing table, promoting consistency and reducing the risk of discrepancies.
- **Statistical Foundation**: It serves as a foundational component for a live ablation runner, emphasizing its role in providing reliable metrics for performance evaluation.
- **Clear Interfaces**: The use of TypeScript interfaces (`Usage`, `PricingRow`, `Run`) provides a structured way to handle data, enhancing type safety and clarity.

Overall, `honest-metrics.ts` is structured to ensure accurate, reproducible, and consistent reporting of usage and costs in a controlled environment.

## tradeoff-median-vs-mean (trade-off / tune)

### prose=off (400 mean output tokens)

When reporting costs in a cost-per-task benchmark, the choice between using the **median** and the **mean** depends on the distribution of the cost data and the presence of outliers.

### Mean Cost
- **Definition**: The mean is the average cost calculated by summing all costs and dividing by the number of tasks.
- **When to Use**:
  - The cost data is normally distributed (bell-shaped curve).
  - There are no significant outliers that could skew the average.
- **Trade-offs**:
  - **Pros**: Provides a comprehensive view of the overall cost, taking all data points into account.
  - **Cons**: Sensitive to outliers; a few extremely high or low costs can distort the mean, making it less representative of typical performance.

### Median Cost
- **Definition**: The median is the middle value when costs are sorted in ascending order.
- **When to Use**:
  - The cost data is skewed or has outliers.
  - You want to represent the "typical" cost without the influence of extreme values.
- **Trade-offs**:
  - **Pros**: More robust against outliers; provides a better representation of the central tendency in skewed distributions.
  - **Cons**: Does not account for all data points, potentially overlooking the impact of extreme values on overall performance.

### Summary
- **Use the Mean** when the data is symmetrically distributed and you want to capture the overall average cost.
- **Use the Median** when the data is skewed or contains outliers, as it better reflects the typical cost experienced by most tasks.

In practice, it can be beneficial to report both metrics to provide a fuller picture of the cost landscape, especially in cases where the data distribution is not clear.

### prose=full (349 mean output tokens)

**Median Cost vs. Mean Cost in Cost-Per-Task Benchmarking**

### Mean Cost
- **Definition**: Average of all costs.
- **Use Case**: Best for normally distributed data without extreme outliers.
- **Advantages**:
  - Sensitive to all data points.
  - Useful for understanding overall performance.
- **Disadvantages**:
  - Can be skewed by outliers (very high or low costs).
  - May not represent typical performance if data is not symmetrically distributed.

### Median Cost
- **Definition**: Middle value when costs are sorted.
- **Use Case**: Best for skewed distributions or when outliers are present.
- **Advantages**:
  - Robust against outliers; reflects the central tendency of the majority.
  - Provides a better representation of typical costs in non-normal distributions.
- **Disadvantages**:
  - Ignores the magnitude of all data points.
  - Less sensitive to changes in the dataset.

### Trade-offs
- **Mean**: Good for overall performance but can mislead if outliers are present.
- **Median**: More reliable in skewed distributions but may overlook significant variations in costs.

### When to Use Each
- **Use Mean**:
  - When data is symmetrically distributed.
  - When you want to highlight overall performance, including extremes.

- **Use Median**:
  - When data has outliers or is skewed.
  - When you want to focus on typical performance and minimize the impact of extreme values.

### Conclusion
Choose the median for a more accurate representation in skewed datasets or when outliers are present. Use the mean for a comprehensive view of overall performance in normally distributed data.

## tradeoff-temp0-vs-repeats (trade-off / tune)

### prose=off (461 mean output tokens)

When measuring stable token counts in language models, both setting the temperature to 0 and averaging over multiple repeats (N > 1) can be useful, but they serve different purposes and contexts.

### Setting Temperature = 0
- **Purpose**: This setting makes the model deterministic, meaning it will always produce the same output for a given input. This is useful for:
  - **Consistency**: Ensures that the same input yields the same output, which is critical for benchmarking and comparisons.
  - **Baseline Measurements**: Provides a clear baseline for token counts without the variability introduced by randomness.

### Averaging Over N > 1 Repeats
- **Purpose**: This approach introduces variability in the model's responses, which can be beneficial for:
  - **Understanding Variability**: Helps capture the range of outputs the model can produce, especially in creative tasks where randomness is expected.
  - **Smoothing Out Noise**: Averaging can reduce the impact of outliers or extreme values in token counts, leading to a more stable measurement over time.

### When to Use Each
- **Use Temperature = 0**:
  - When you need precise, repeatable measurements for benchmarking or testing.
  - When the goal is to evaluate the model's performance on a specific task without variability.

- **Use Averaging Over N > 1**:
  - When the task involves inherent variability, such as creative writing or generating diverse outputs.
  - When you want to assess the model's performance across a range of outputs to understand its behavior better.

### When to Use Both
- **Combined Approach**:
  - In scenarios where you want to ensure consistency (temperature = 0) but also want to assess the stability of token counts across multiple inputs or slight variations in input.
  - When evaluating the model's performance in a controlled environment while still accounting for potential variability in outputs.

### Summary
- **Temperature = 0**: Best for deterministic, consistent outputs.
- **Averaging Over N > 1**: Best for capturing variability and smoothing results.
- **Both**: Useful for controlled evaluations with some variability in inputs or conditions.

### prose=full (280 mean output tokens)

### Temperature=0
- **Purpose**: Fixes model output, ensuring deterministic results.
- **Use Cases**:
  - **Consistency**: Ideal for tasks requiring exact replication of outputs (e.g., benchmarks).
  - **Control**: Useful when evaluating specific model behavior without variability.

### Averaging Over N>1 Repeats
- **Purpose**: Mitigates randomness in outputs by averaging results from multiple runs.
- **Use Cases**:
  - **Stability**: Helps in scenarios where outputs are inherently variable (e.g., creative tasks).
  - **Noise Reduction**: Effective when measuring performance metrics that can fluctuate significantly.

### When to Use Both
- **Complex Tasks**: For tasks where both consistency and variability are present, using temperature=0 ensures deterministic outputs, while averaging over N>1 provides a more stable measure of performance.
- **Benchmarking**: In scenarios where you want to assess the model's reliability and performance across multiple dimensions, combining both methods can yield the most accurate insights.

### Summary
- **Temperature=0**: Best for deterministic outputs.
- **Averaging**: Best for reducing variability.
- **Both**: Best for complex evaluations needing both stability and consistency.

## risk-cave-always-on (risk-enumeration / tune)

### prose=off (632 mean output tokens)

Running cave-mode (terse-prose styling) always-on in production for a coding agent can introduce several risks and potential failure modes:

### 1. **Loss of Clarity**
   - **Failure Mode**: Responses may become overly concise, sacrificing necessary context or detail.
   - **Who It Hurts**: Developers and users relying on clear, comprehensive explanations may struggle to understand the agent's outputs, leading to confusion and misinterpretation.

### 2. **Increased Miscommunication**
   - **Failure Mode**: Ambiguities in terse responses can lead to misunderstandings about code functionality or instructions.
   - **Who It Hurts**: Team members and stakeholders may misinterpret critical information, resulting in errors in implementation or decision-making.

### 3. **Reduced User Engagement**
   - **Failure Mode**: A terse style may come off as unapproachable or robotic, discouraging user interaction.
   - **Who It Hurts**: Users may feel less inclined to engage with the agent, reducing its effectiveness and utility.

### 4. **Difficulty in Debugging**
   - **Failure Mode**: Lack of detailed explanations can hinder troubleshooting and debugging processes.
   - **Who It Hurts**: Developers may find it challenging to identify and resolve issues quickly, leading to increased downtime or bugs in production.

### 5. **Inadequate Documentation**
   - **Failure Mode**: Terse responses may not provide sufficient documentation for code or features.
   - **Who It Hurts**: New team members or users may struggle to onboard effectively, leading to a steep learning curve and potential errors.

### 6. **Overlooked Edge Cases**
   - **Failure Mode**: Important edge cases or exceptions may be glossed over in favor of brevity.
   - **Who It Hurts**: Users may encounter unexpected behavior or failures in edge cases, leading to frustration and loss of trust in the system.

### 7. **Inflexibility in Communication Style**
   - **Failure Mode**: A rigid communication style may not adapt to the needs of different users or contexts.
   - **Who It Hurts**: Diverse teams with varying levels of expertise may find the communication style unsuitable, leading to disengagement or errors.

### 8. **Increased Cognitive Load**
   - **Failure Mode**: Users may need to spend more time deciphering terse responses, increasing cognitive load.
   - **Who It Hurts**: This can lead to fatigue and decreased productivity, particularly in high-stakes environments.

### 9. **Potential for Misleading Information**
   - **Failure Mode**: Terse responses may inadvertently omit critical warnings or caveats.
   - **Who It Hurts**: Users may act on incomplete or misleading information, leading to significant errors or security vulnerabilities.

### Conclusion
While terse prose can enhance efficiency in some contexts, its always-on application in a coding agent can lead to significant risks that primarily affect developers, users, and the overall effectiveness of the system. Balancing brevity with clarity and context is crucial to mitigate these risks.

### prose=full (396 mean output tokens)

Running cave-mode (terse-prose styling) always-on in production for a coding agent poses several risks:

### Failure Modes

1. **Miscommunication**
   - **Risk**: Lack of clarity in instructions or responses.
   - **Impact**: Users may misinterpret commands or guidance, leading to incorrect actions.

2. **Reduced Context**
   - **Risk**: Important context or nuances may be omitted.
   - **Impact**: Users may miss critical information, resulting in errors or incomplete tasks.

3. **User Frustration**
   - **Risk**: Users may find terse responses unhelpful or confusing.
   - **Impact**: Decreased user satisfaction and potential abandonment of the tool.

4. **Increased Support Burden**
   - **Risk**: More user queries and support requests due to misunderstandings.
   - **Impact**: Higher workload for support teams, diverting resources from development.

5. **Loss of Engagement**
   - **Risk**: Users may feel less engaged with a robotic communication style.
   - **Impact**: Reduced collaboration and feedback, hindering improvement and innovation.

6. **Error Propagation**
   - **Risk**: Quick, terse responses may lead to overlooked errors.
   - **Impact**: Errors can propagate through workflows, causing larger issues down the line.

7. **Inflexibility**
   - **Risk**: Inability to adapt communication style based on user needs.
   - **Impact**: Alienation of users who prefer more detailed or conversational interactions.

### Who They Hurt

- **End Users**: Experience confusion, frustration, and potential errors in their workflows.
- **Support Teams**: Increased volume of queries and need for clarification.
- **Development Teams**: Diverted focus from feature development to addressing user issues.
- **Overall Product Reputation**: Perception of the tool may decline, affecting user retention and acquisition.

## trace-reduction-null-baseline (multi-step-trace / tune)

### prose=off (422 mean output tokens)

To trace the function `outputReductionPct(outputOff, outputFull)` step by step when `outputOff` is `0`, we need to understand the function's logic and how it processes its inputs. 

### Step-by-Step Breakdown

1. **Function Call**: 
   - The function is called with `outputOff = 0` and `outputFull` (let's assume it's a positive number).

2. **Calculation**:
   - The function likely calculates the percentage reduction based on the formula:
     \[
     \text{reduction\_pct} = \left( \frac{\text{outputFull} - \text{outputOff}}{\text{outputFull}} \right) \times 100
     \]
   - Substituting `outputOff = 0`:
     \[
     \text{reduction\_pct} = \left( \frac{\text{outputFull} - 0}{\text{outputFull}} \right) \times 100 = 100
     \]

3. **Return Value**:
   - The function returns `100`, indicating a full reduction since `outputOff` is `0`.

### Caller Behavior

1. **Aggregate**:
   - The aggregate function might use this value to summarize the overall reduction across multiple outputs. A `100%` reduction could indicate that no output is being produced, which might trigger specific handling (e.g., logging, alerts).

2. **Table**:
   - The table might display this value as part of a report or dashboard. A `100%` reduction could be highlighted to indicate a complete lack of output, prompting further investigation or action.

### Summary

- **Return Value**: `100`
- **Reason**: The calculation shows that with `outputOff` being `0`, the entire output is considered reduced.
- **Caller Actions**: The aggregate may log or alert on this condition, while the table displays it, potentially indicating a critical state that requires attention.

### prose=full (407 mean output tokens)

To trace the function `outputReductionPct(outputOff, outputFull)` step by step when `outputOff` is `0`, we need to analyze the function's logic. Here's a typical breakdown of what happens:

1. **Function Definition**:
   - The function likely calculates the percentage reduction of some output based on two parameters: `outputOff` (the amount of output that is off) and `outputFull` (the total output).

2. **Input Values**:
   - Given `outputOff = 0`, we need to consider the value of `outputFull`. If `outputFull` is also `0`, it may lead to a division by zero scenario.

3. **Calculation**:
   - The function likely computes the reduction percentage using a formula similar to:
     ```python
     reduction_pct = (outputOff / outputFull) * 100
     ```
   - With `outputOff = 0`, the calculation simplifies to:
     ```python
     reduction_pct = (0 / outputFull) * 100 = 0
     ```

4. **Return Value**:
   - The function returns `0` if `outputOff` is `0`, indicating no reduction in output.

5. **Callers' Usage**:
   - **Aggregate**: The aggregate might use this value to summarize overall performance or efficiency. A return value of `0` suggests that the output is fully operational, which could be a positive indicator.
   - **Table**: The table might display this percentage in a user interface, showing that there is no reduction in output. This could be part of a dashboard or report where users can quickly assess system performance.

### Summary
- **Return Value**: `0`
- **Reason**: No output is off, hence no reduction.
- **Callers' Actions**:
  - Aggregate: Use `0` to indicate full operational status.
  - Table: Display `0%` reduction, indicating no issues with output.

## factual-temp0-meaning (short-factual / tune)

### prose=off (47 mean output tokens)

Setting an LLM sampling temperature to 0 makes the model deterministic, causing it to always select the highest probability output for each token. This results in more predictable and repetitive responses, as there is no randomness in the generation process.

### prose=full (43 mean output tokens)

Setting an LLM sampling temperature to 0 makes the model deterministic, producing the same output for a given input every time. It selects the most probable next token, leading to less variability and more repetitive responses.
