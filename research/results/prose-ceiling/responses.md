# Prose Microbench — responses (off vs candidate)

## code-explain-roles (code-explain / tune)

### prose=off (506 mean output tokens)

The `roles.ts` module manages role-tagging for outbound agent calls in a TypeScript codebase. Here's a summary of its purpose and design:

### Purpose
The module ensures that every outbound call from the agent incorporates exactly one specific role. It prevents calls that lack a required role or have multiple roles, leading to predictable and testable behavior.

### Design Overview
1. **Type Definition**:
   - The `Role` type is defined as a union of string literals: `"plan"`, `"edit"`, `"explore"`, and `"verify"`.

2. **Roles Array**:
   - `ROLES` is a constant array containing all valid roles, ensuring that the list is immutable (`readonly`) and type-safe through TypeScript's `as const` assertion.

3. **Role Validation Function**:
   - The `isRole` function checks if a given value is a valid role by verifying its type and confirming its presence in the `ROLES` array.

4. **Role Tagged Interface**:
   - The interface `RoleTagged<T>` defines a structure that consists of a `role` and a `payload`, where `payload` can be of any type (`T`).

5. **Require Role Function**:
   - The `requireRole` function ensures that an object must have a valid role. If the role is missing or invalid, it throws an error, enforcing that outbound calls conform to the expected structure. If valid, it returns an object of type `RoleTagged<T>`.

### Summary
Overall, this module encapsulates the concept of role-tagging for outbound agent calls, providing a clear type structure and validation methods to maintain integrity in the agent's operations. It ensures that each call is properly tagged with a valid role, which is crucial for the system's correctness and reliability.

### prose=ultra (424 mean output tokens)

### Summary of `packages/agent/src/roles.ts`

**Purpose:** 
- Enforces use of a single role in outbound agent LLM (Language Model) calls. 
- Ensures that every outbound call contains exactly one valid role, preventing multiple roles.

**Design Components:**

1. **Role Type Definition:**
   - `export type Role = "plan" | "edit" | "explore" | "verify";`
   - Defines a union type for valid roles, limiting options to four specific strings.

2. **Roles Constant:**
   - `export const ROLES: readonly Role[] = ["plan", "edit", "explore", "verify"] as const;`
   - An array that holds the valid roles, marked as readonly to prevent modification. 

3. **Role Validation Function:**
   - `export function isRole(value: unknown): value is Role {...}`
   - Checks if a provided value is a valid role. Returns a type predicate to narrow the type when valid.

4. **Role-Tagged Interface:**
   - `export interface RoleTagged<T = unknown> {...}`
   - Defines a structure that pairs a `role` with any associated payload of type `T`.

5. **Role Requirement Function:**
   - `export function requireRole<T>(value: { role?: unknown; payload: T }): RoleTagged<T> {...}`
   - Validates the `role` from the input object and throws an error if invalid or missing. Returns a RoleTagged object with the validated role and the original payload.

### Design Characteristics:
- **Type Safety:** Utilizes TypeScript features like union types and interfaces to enforce type correctness.
- **Error Handling:** Clearly defines error conditions for invalid or missing role scenarios.
- **Extensibility:** The design allows for other payload types due to its generic nature (`<T>`).
- **Simplicity:** Straightforward functions and types make the module easy to understand and use.

## code-explain-honest-metrics (code-explain / tune)

### prose=off (443 mean output tokens)

The provided code snippet from `research/evals/honest-metrics.ts` is a TypeScript module designed for handling accounting and statistical evaluations within a software project, specifically focused on managing token usage and associated costs for different model runs in a caveman AI system.

### Purpose
1. **Accounting and Statistics**: It tracks the usage of tokens (input, output, cache) and computes costs related to the execution of various models.
2. **Deterministic Functionality**: The module is designed to be purely functional, emphasizing deterministic behavior where outputs are solely based on inputs, making it suitable for unit testing.

### Design Summary
- **Pure Module**: 
  - The module does not perform any I/O operations, process spawning, or access to external resources (like the filesystem or clocks). This reinforces predictability and testability.
  - A seeded pseudo-random number generator (PRNG) can be used during bootstrap for reproducibility in tests.

- **Cost Computation**:
  - Costs are calculated using a consistent pricing table, with a function `computeCost` that determines the total cost based on predefined pricing for each usage type (input, output, cache read/write).
  - The cost computation is grounded on a single source of truth for pricing data.

- **Usage Interface**: 
  - A data structure (interface) named `Usage` captures the token usage metrics (input, output, cache reads, and writes) for evaluation.
  - A supplementary function, `totalProcessed`, calculates the total tokens processed for diagnostic purposes.

- **Run Record**:
  - The `Run` interface encapsulates data about individual runs of the model, including operational levels, model identifiers, tasks, seed numbers, resolution status (determined externally), usage data, and parsing status.

### Conclusion
This module serves as a robust foundation for managing costs and usage statistics in a systematic way, ensuring that evaluations of different models can be conducted accurately and reproducibly. Its design reflects a focus on determinism and data integrity, ultimately providing a reliable framework for financial assessment and runtime metrics within the broader application.

### prose=ultra (516 mean output tokens)

### Overview
`honest-metrics.ts` handles deterministic accounting and statistics for evaluating performance in a TypeScript project, focusing on cost metrics related to token usage.

### Key Features
- **Pure Module**: 
  - No I/O, process spawning, filesystem access, or clock usage.
  - Deterministic outputs based on inputs, facilitating reproducible tests.

- **Shared Pricing**:
  - Cost calculations are based on a single price table.
  - Functions return token usage without dollar amounts—centralized pricing serves as the "single source of truth."

- **Resolved Metric**:
  - The `resolved` metric signifies completion via a shared scorer, not relying on tool exit codes.

### Components
1. **Interfaces**:
   - **Usage**: Tracks different token types (input, output, cache read/write).
   - **PricingRow**: Contains per-million-token dollar rates.

2. **Functions**:
   - **totalProcessed**: Calculates total tokens processed (diagnostic purpose).
   - **computeCost**: Calculates dollar costs based on token usage and pricing, returns null if no pricing row exists.

3. **Run Record**:
   - Captures execution details like model level, task, seed, resolution status, and usage metrics.

### Design Summary
- **Deterministic Approach**: Ensures predictability and testability.
- **Centralized Pricing**: Maintains consistency in cost reporting.
- **Modular Structure**: Clear separation of usage, pricing, and record-keeping enhances maintainability.
- **Utility Focus**: Primarily focused on metrics and statistics, allowing it to serve as a foundational module for broader functionalities, such as performance evaluation or cost analysis.

## tradeoff-median-vs-mean (trade-off / tune)

### prose=off (403 mean output tokens)

In a cost-per-task benchmark, the choice between reporting the **median** and **mean** cost depends on the distribution of the data and the presence of outliers.

### Mean Cost
- **Definition**: The mean is the arithmetic average of all costs.
- **When to Use**: 
  - When the cost distribution is **normal** (bell-shaped) and lacks significant outliers.
  - If every data point is relevant and contributes equally to the overall cost, the mean provides a useful average.

### Median Cost
- **Definition**: The median is the middle value when costs are sorted in order.
- **When to Use**:
  - When the cost distribution is **skewed** (e.g., some tasks are much more expensive than others).
  - If there are **outliers** that could significantly distort the mean, the median gives a better representation of the central tendency.
  - When you need to summarize the data in a way that reduces the influence of extreme values, making it more robust.

### Trade-offs
- **Mean**:
  - **Pros**: Sensitive to all values, captures all data points.
  - **Cons**: Can be distorted by outliers or skewed distributions, potentially misleading if the data is not uniformly distributed.

- **Median**:
  - **Pros**: Provides a better central tendency in the presence of outliers or non-normal distributions.
  - **Cons**: Less sensitive to small changes in the lower or upper tails of the distribution, which might overlook significant variations in costs.

### Conclusion
- Use the **mean** when you have a normal distribution and no outliers, providing a clear average of costs across tasks.
- Use the **median** when dealing with skewed distributions or when outliers are present, providing a more accurate reflection of typical costs without being affected by extreme values. 

Choosing the right measure can impact decision-making, resource allocation, and performance assessment in cost-per-task benchmarks.

### prose=ultra (301 mean output tokens)

**Median Cost:**
- **When to Use:** 
  - Use when data distribution is skewed or contains outliers.
  - Situations where you need to reflect typical performance across a diverse set of tasks.

- **Trade-offs:**
  - More robust to outliers, providing a better measure of central tendency for non-normally distributed data.
  - May ignore significant cost variations that mean would capture.

**Mean Cost:**
- **When to Use:** 
  - Use with normally distributed data or when there are no extreme outliers.
  - Ideal for datasets where every value contributes to the overall cost (e.g., small sample sizes).

- **Trade-offs:**
  - Sensitive to outliers, which can skew the average and misrepresent true costs.
  - Reflects overall performance, including variations, but may mislead if outliers significantly affect the average.

**Summary:**  
- **Median**: Best for skewed distributions, providing a clearer picture of typical costs.
- **Mean**: Best for balanced datasets, capturing all cost variations, but vulnerable to skew from outliers. 

Choose based on data characteristics and stakeholder interests.

## tradeoff-temp0-vs-repeats (trade-off / tune)

### prose=off (451 mean output tokens)

To evaluate stable token-count measurements using temperature settings and averaging over multiple repeats, it's essential to understand how each factor influences output variability.

### Setting Temperature to 0

- **Purpose**: Setting the temperature to zero results in deterministic outputs. The model will always choose the most probable token at each step, minimizing randomness.
- **When It Helps**:
  - **Consistency**: If a consistent output is required (for testing or benchmarking), a temperature of 0 ensures reproducibility.
  - **Measuring Base Performance**: It provides a baseline to understand how the model performs without introducing variance from random sampling.

### Averaging Over N Repeats

- **Purpose**: Averaging results over multiple runs helps smoothen out variability in the output due to inherent randomness in the model's predictions.
- **When It Helps**:
  - **Stochastic Nature**: If the model's behavior is stochastic (e.g., when using higher temperatures), averaging mitigates the influence of outlier results.
  - **Performance Evaluation**: It helps to evaluate how the model performs over various scenarios, providing a more balanced view of its capabilities.

### When to Use Both

- **Need for Determinism and Stability**: If the task requires both consistency (deterministic outputs) and the benefits of averaging (like during robustness checks), use both:
  - **Temperature = 0 with N > 1**: This scenario might be rare as averaging is more beneficial when randomness is present. However, if there's any slight variability (e.g., due to environmental differences), this combination is safest.

### Conclusion

- **Choose Temperature = 0** for scenarios needing consistency and reproducibility.
- **Choose Averaging** when outputs are variable or stochastic.
- Using both is mainly beneficial when slight variability exists alongside a need for deterministic behavior, but typically, one approach suffices for each specific use case.

### prose=ultra (304 mean output tokens)

### Setting Temperature=0 vs. Averaging Over N>1 Repeats

#### Temperature=0
- **Purpose**: Ensures deterministic outputs; removes randomness.
- **Use Case**:
  - Scenarios where consistent results are critical (e.g., benchmarks, analytics).
  - When evaluating the model's performance on fixed inputs.
- **Limitations**: May lead to less diverse outputs; if the model has inherent biases or flaws, these will be consistently reflected.

#### Averaging Over N>1 Repeats
- **Purpose**: Mitigates variability in model outputs; improves robustness of the measurements.
- **Use Case**:
  - Useful when exploring variations in outputs due to inherent randomness.
  - When assessing model stability across a range of scenarios or inputs.
- **Limitations**: Adds computational cost; can mask individual variability.

#### When to Use Both
- **Purpose**: Combines deterministic output with stability from averaging.
- **Use Case**:
  - When high precision is needed, and variability must be minimized.
  - Scenarios requiring absolute reliability in assessment (e.g., comparative studies between different models or settings).

### Conclusion
- Use **temperature=0** for deterministic, consistent outputs.
- Use **averaging** for robustness against variability.
- Use **both** for high precision in sensitive evaluations.

## risk-cave-always-on (risk-enumeration / tune)

### prose=off (580 mean output tokens)

Running cave-mode (terse-prose styling) always-on in production for a coding agent could introduce several risks and failure modes, including:

1. **Reduced Clarity in Communication**  
   - **Failure Mode**: Critical information may be presented in a highly terse manner, leading to misunderstandings or lack of clarity.
   - **Who It Hurts**: Developers, end-users, and other stakeholders relying on clear instructional content.

2. **Difficulty in Debugging**  
   - **Failure Mode**: Terse responses may omit essential context or error messages needed to diagnose issues.
   - **Who It Hurts**: Developers and QA teams who need detailed information for troubleshooting.

3. **User Frustration**  
   - **Failure Mode**: A lack of detailed guidance can frustrate users who require step-by-step instructions or contextual explanations.
   - **Who It Hurts**: End-users and support teams managing user inquiries or complaints.

4. **Increased Training Time for New Users**  
   - **Failure Mode**: New users may struggle with the condensed information, leading to a steeper learning curve and longer onboarding times.
   - **Who It Hurts**: New developers and team members who need to quickly adapt to tools and processes.

5. **Potential for Misinterpretation**  
   - **Failure Mode**: Short or vague messages can lead to misinterpretation of commands, leading to incorrect actions or programming errors.
   - **Who It Hurts**: Developers making critical decisions based on ambiguous instructions.

6. **Inadequate Documentation**  
   - **Failure Mode**: Documentation might become insufficient, lacking the depth required for comprehensive understanding of features or processes.
   - **Who It Hurts**: All stakeholders who depend on well-documented protocols for consistent development practices.

7. **Compromised User Experience**  
   - **Failure Mode**: A lack of engaging, narrative context can lead to a sterile experience that may not resonate with users.
   - **Who It Hurts**: End-users who seek not only functionality but also a pleasant interaction with tools.

8. **Technical Debt**  
   - **Failure Mode**: Quick fixes and terse directives may prioritize speed over thoroughness, leading to unresolved issues accumulating over time.
   - **Who It Hurts**: Future development teams who inherit this technical debt and need to resolve the underlying problems.

9. **Misalignment with Organizational Standards**  
   - **Failure Mode**: The terse communication style may clash with existing documentation and communication standards, confusing stakeholders.
   - **Who It Hurts**: The organization as a whole, potentially affecting productivity and collaboration.

10. **Security Risks**  
    - **Failure Mode**: Important security-related instructions might be lost or inadequately communicated, leaving systems vulnerable.
    - **Who It Hurts**: The organization and its users due to potential security breaches. 

Considering these risks, it's vital to assess the trade-offs of maintaining terse communication against the requirements for clarity and comprehensiveness in a production environment.

### prose=ultra (508 mean output tokens)

Running cave-mode (terse-prose) always-on in production for a coding agent poses several risks:

1. **Miscommunication**:
   - **Failure Mode**: Lack of clarity in responses can lead to misunderstandings between users and agents.
   - **Who It Hurts**: Users; they may misinterpret instructions or code changes.

2. **Error Propagation**:
   - **Failure Mode**: Ambiguous error messages may provide insufficient detail for troubleshooting.
   - **Who It Hurts**: Developers; they may struggle to diagnose and fix issues quickly.

3. **User Frustration**:
   - **Failure Mode**: Users accustomed to normal language may feel alienated or confused by terse responses.
   - **Who It Hurts**: End users; they may experience decreased satisfaction and trust in the system.

4. **Increased Support Load**:
   - **Failure Mode**: More inquiries and requests for clarification due to vague communication.
   - **Who It Hurts**: Support teams; they may face a higher volume of tickets and longer resolution times.

5. **Documentation Quality**:
   - **Failure Mode**: Less detailed explanations in generated documentation or comments, reducing usability.
   - **Who It Hurts**: Future developers and users; they may find it hard to understand or utilize the code.

6. **Safety Oversights**:
   - **Failure Mode**: Important safety or security warnings may be lost in terse communication.
   - **Who It Hurts**: System integrity; leading to potential vulnerabilities and exploits.

7. **Compliance Risks**:
   - **Failure Mode**: Inadequate explanations may breach regulatory or documentation requirements.
   - **Who It Hurts**: Organizations; could lead to legal consequences or compliance audits.

8. **Onboarding Difficulties**:
   - **Failure Mode**: New users and team members may struggle to understand the system.
   - **Who It Hurts**: Newcomers; they may face a steeper learning curve and reduce productivity.

9. **Context Loss**:
   - **Failure Mode**: Complex issues may not be adequately contextualized, leading to ineffective solutions.
   - **Who It Hurts**: Users seeking assistance; they may receive incomplete or incorrect guidance.

10. **Over-simplification**:
    - **Failure Mode**: Reduction of rich content into overly simplistic formats, leading to information loss.
    - **Who It Hurts**: Users relying on nuanced understanding; critical insights may be missed.

These risks reflect the need for a balance between succinctness and clarity in communication to maintain effectiveness, usability, and safety in production environments.

## trace-reduction-null-baseline (multi-step-trace / tune)

### prose=off (466 mean output tokens)

To understand the behavior of the function `outputReductionPct(outputOff, outputFull)` when `outputOff` is `0`, let's break it down step by step.

### 1. Function Execution
Assuming `outputReductionPct` is defined similarly to:

```python
def outputReductionPct(outputOff, outputFull):
    if outputFull == 0:
        return 0  # Prevent division by zero
    return (outputOff / outputFull) * 100
```

### 2. Input Parameters
- **`outputOff`**: 0
- **`outputFull`**: (This would be set depending on the context, but let's assume a non-zero value, e.g., `100` for this explanation.)

### 3. Step-by-Step Execution
- **Step 1**: The function checks if `outputFull` is `0`. If it is, it returns `0` to avoid division by zero.
  
- **Step 2**: If `outputFull` is not `0`, the function calculates the reduction percentage using the formula:
  \[
  \text{reduction} = \left(\frac{\text{outputOff}}{\text{outputFull}}\right) \times 100
  \]
  
    Substituting in our values:
    \[
    \text{reduction} = \left(\frac{0}{100}\right) \times 100 = 0
    \]

### 4. Return Value
- The function returns `0` since `outputOff` is `0`.

### 5. Caller Context
Now considering how the callers, such as "the aggregate" or "the table," handle this return value:

- **Aggregate**: It may use this value to represent the proportion of the output that is reduced (in this case, no reduction happened). It might log or display this value as part of summary statistics.
  
- **Table**: If this function's output is used in a table, it would typically show `0%` reduction in a relevant column. This indicates that there was no reduction in the output.

### Summary
When `outputOff` is `0`, the function `outputReductionPct` returns `0`. Callers will interpret this value to indicate no reduction in output, which can be logged or displayed in user interfaces.

### prose=ultra (346 mean output tokens)

To trace `outputReductionPct(outputOff, outputFull)` with `outputOff = 0`, we need to understand the function's implementation and the logic that follows.

Let's break it down:

1. **Function Call**: `outputReductionPct(0, outputFull)`

2. **Assumptions**: 
   - `outputFull`: Represents the full output value (assumed > 0).

3. **Typical Implementation**:
   If we assume a typical implementation like this:
   ```python
   def outputReductionPct(outputOff, outputFull):
       if outputFull == 0:
           return 0  # Avoid division by zero

       return (outputOff / outputFull) * 100
   ```

4. **Return Value**:
   - Given `outputOff = 0`, the function performs the calculation: 
     \[
     \text{result} = \left( \frac{0}{outputFull} \right) \times 100 = 0
     \]
   - Hence, it returns `0`.

5. **Why Return 0**:
   - Returning `0` indicates no reduction in output since `outputOff` is `0`. This signifies that the output is fully utilized.

6. **Caller Actions**:
   - **The Aggregate**: 
     - Would interpret this as no reduction observed. If it aggregates several values, it may calculate the overall efficiency or productivity, possibly logging this as a non-reductive output.
   - **The Table**:
     - Display this value as `0%`, representing no output reduction. It provides users with a clear understanding of output metrics and could trigger alerts if unexpected. 

In summary, `outputReductionPct(0, outputFull)` returns `0`, signaling to callers an absence of output reduction.

## factual-temp0-meaning (short-factual / tune)

### prose=off (50 mean output tokens)

Setting an LLM sampling temperature to 0 makes the output deterministic, meaning the model will always produce the same response for a given input. It effectively reduces randomness, leading to more confident and predictable outputs, often favoring the most likely option given the probabilities.

### prose=ultra (34 mean output tokens)

Setting an LLM sampling temperature to 0 leads to deterministic output. The model will always generate the same response to a given input, choosing the highest probability predictions without randomness.
