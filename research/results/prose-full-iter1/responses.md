# Prose Microbench — responses (off vs candidate)

## code-explain-roles (code-explain / tune)

### prose=off (439 mean output tokens)

The role-tagging module in TypeScript manages and enforces the use of specific roles for outbound calls made by agents in the codebase. Here's a breakdown of its components and design:

### Overview

- **Role Definition**: It defines four possible roles (`plan`, `edit`, `explore`, `verify`) that can be associated with outbound calls. Each call must have exactly one of these roles to be considered valid.

### Design Components

1. **Type Definition**:
   ```ts
   export type Role = "plan" | "edit" | "explore" | "verify";
   ```
   - This defines a `Role` type that restricts possible values to a finite set, ensuring type safety when assigning roles.

2. **Constant Array**:
   ```ts
   export const ROLES: readonly Role[] = ["plan", "edit", "explore", "verify"] as const;
   ```
   - This array represents the valid roles. The `readonly` modifier ensures the array cannot be modified, reinforcing immutability.

3. **Role Validation Function**:
   ```ts
   export function isRole(value: unknown): value is Role {
       return typeof value === "string" && (ROLES as readonly string[]).includes(value);
   }
   ```
   - This function checks if a given value is a valid role. It returns a type predicate, narrowing the type to `Role` if the check succeeds.

4. **Role-tagged Interface**:
   ```ts
   export interface RoleTagged<T = unknown> {
       role: Role;
       payload: T;
   }
   ```
   - This interface combines a `role` and a corresponding `payload`, allowing for the structured representation of outbound messages.

5. **Role Requirement Function**:
   ```ts
   export function requireRole<T>(value: { role?: unknown; payload: T }): RoleTagged<T> {
       if (!isRole(value.role)) {
           throw new Error(`roles: outbound call missing or invalid role (got ${JSON.stringify(value.role)})`);
       }
       return { role: value.role, payload: value.payload };
   }
   ```
   - This function ensures that any outbound call contains a valid role. If the role is missing or invalid, it throws an error; otherwise, it returns a `RoleTagged` object.

### Summary

The module employs a clear and strict approach to managing roles for outbound agent calls, ensuring each call adheres to the specified role structure. The design emphasizes immutability, type safety, and error handling, making it robust and easy to use while preventing errors related to role assignment.

### prose=full (464 mean output tokens)

The `roles.ts` module defines a system for managing role tags in outbound LLM (Language Model) calls within a TypeScript codebase. Here’s a breakdown of its components and design:

### Purpose

- Ensures that every outbound call to the agent carries exactly one role.
- Prevents errors caused by missing or multiple roles, which can lead to test failures.

### Components

1. **Role Type**:
   - Defines a union type `Role` consisting of four possible values: `"plan"`, `"edit"`, `"explore"`, and `"verify"`.

2. **Roles Array**:
   - `ROLES` is a constant array containing the defined roles, leveraging TypeScript's `readonly` for immutability.

3. **Type Guard**: 
   - `isRole(value: unknown): value is Role`: 
     - A type guard function that checks if a given value is a valid `Role`. It ensures that the value is a string and is included in the `ROLES` array.

4. **RoleTagged Interface**:
   - Defines a structure that associates a `role` with a `payload`. The payload can be of any type (defaulted to `unknown`).

5. **Role Requirement Function**:
   - `requireRole<T>(value: { role?: unknown; payload: T })`: 
     - Takes an object that may or may not have a `role` and a `payload`.
     - Throws an error if the `role` is missing or invalid, ensuring that only valid role-tagged payloads are processed.
     - Returns a `RoleTagged` object, enforcing the presence of a valid role.

### Design Summary

- **Type Safety**: Uses TypeScript features (union types, interfaces, type guards) to enforce type safety and prevent invalid data.
- **Error Handling**: Consistently checks roles during outbound calls, throwing descriptive errors for invalid roles.
- **Immutability**: `ROLES` is defined as a readonly array, preventing modifications and ensuring its integrity.
- **Extensibility**: Can be easily extended by adding new roles to the `Role` type and `ROLES` array without impacting existing functionality.

Overall, this module serves as a robust mechanism for tagging payloads in outbound agent calls with roles, enhancing the reliability and maintainability of the codebase.

## code-explain-honest-metrics (code-explain / tune)

### prose=off (502 mean output tokens)

The provided TypeScript file, `honest-metrics.ts`, serves as a module for handling accounting and statistics related to token usage and cost within a system. Its purpose is to facilitate the evaluation of different operational modes, specifically focusing on a "caveman" system that can be toggled between on and off states (hence the title "ON-vs-OFF ablation").

### Key Functions & Design Summary:

1. **Pure Module Characteristics**:
   - It adheres to a pure functional programming model, meaning it doesn't interact with external systems (no I/O, filesystem access, or timing functions). This ensures deterministic behavior based on inputs, making it easy to test and maintain.

2. **Deterministic Outputs**:
   - The module uses a seeded pseudo-random number generator (PRNG) for reproducible test outcomes. This is crucial for debugging, as it allows consistent results across different runs.

3. **Single Source of Truth**:
   - All financial calculations derive from a centralized price table via the `computeCost` function. This design avoids discrepancies in cost reporting by ensuring all pricing data is consistently accessed from a single location.
   - Parsers like `parseCodexUsage` focus solely on returning usage metrics (tokens used) without directly calculating costs, preserving clarity in data flow.

4. **Cost Calculation**:
   - The `computeCost` function calculates the dollar cost of token usage based on a given model's rates from the price table. If no price entry exists for a model, it returns `null`, which aids in excluding unpriced runs without misleading outputs.

5. **Run Recording**:
   - The `Run` interface encapsulates the details of a single execution, including usage metrics, operational status (`resolved`), the model used, and the task processed. This structured approach allows for clear record-keeping and easier analysis of run characteristics.

6. **Statistical Support**:
   - Although truncated, the file hints at additional statistical functions tailored for analyzing the run data, emphasizing the module's capability to handle both accounting and statistical reporting, possibly for benchmarking or performance evaluation.

In summary, `honest-metrics.ts` is a well-structured, deterministic module designed to handle the metrics and financial aspects of model execution in a controlled environment. Its emphasis on pure functions, centralized pricing, and structured data recording underlines its efficiency for statistical evaluation and cost management in the codebase.

### prose=full (410 mean output tokens)

`honest-metrics.ts` is a TypeScript module designed for tracking and reporting usage metrics and associated costs for different models in the context of a project, such as a machine learning ablation study. Below is a concise summary of its functionalities and design:

### Purpose
- **Accounting & Statistics:** Focuses on providing pure metrics and statistics regarding resource usage and costs incurred during the operations of a tool, especially around ON-vs-OFF configurations.

### Key Design Features
- **Pure Module:** 
  - No I/O operations, process spawning, filesystem access, clocks, or external dependencies.
  - Deterministic behavior based on input, allowing for reproducibility in tests through seeded pseudo-random number generators (PRNG).

- **Cost Calculation:**
  - Uses a centralized pricing table (`computeCost` function) to compute costs based on token usage.
  - Parsers output token usage values without including dollar costs—ensuring a single source of truth for pricing information.

- **Statistical Independence:**
  - `resolved` values are set by an external scorer, making the tool's exit codes irrelevant to cost calculations.
  - Focuses on clear delineation of metrics to ensure accuracy and reliability in reporting.

### Components
- **Interfaces:**
  - `Usage`: Captures different categories of token usage (input, output, cache reads/writes).
  - `PricingRow`: Contains per-million-token pricing data for each usage category.
  - `Run`: Records details of individual runs, including the model used, task performed, and statistical health.

- **Functions:**
  - `totalProcessed`: Computes the total number of tokens processed for diagnostic purposes.
  - `computeCost`: Calculates the cost based on the `Usage` data against a shared pricing table, returning `null` for unpriced models.

### Summary
Overall, `honest-metrics.ts` serves as the foundational module for reliably computing costs associated with various executions in a deterministic manner. Its design minimizes dependencies and ensures that metrics and pricing calculations are consistent and verifiable, treating inputs as the sole drivers of outputs. The integration of pure functions makes it suitable for unit testing and analytical evaluations in a controlled environment.

## tradeoff-median-vs-mean (trade-off / tune)

### prose=off (414 mean output tokens)

When reporting costs in a cost-per-task benchmark, choosing between the median and mean depends on the distribution of your data and the implications of outliers.

### Mean Cost
- **Use When**: 
  - You want an overall average that includes all data points.
  - The data is symmetrically distributed without significant outliers.
  
- **Advantages**:
  - Reflects the total sum of costs, making it useful for understanding the overall expense.
  
- **Disadvantages**:
  - Sensitive to outliers; a few high or low costs can skew the mean significantly, potentially giving a misleading representation of the typical cost.

### Median Cost
- **Use When**:
  - The data is skewed or has outliers (e.g., some tasks are considerably more expensive).
  - You want to report the middle value in a sorted list, providing a better indication of the "typical" cost.

- **Advantages**:
  - More robust against outliers, providing a more accurate representation in skewed distributions.
  - Better reflects the experience of the majority of tasks.

- **Disadvantages**:
  - Does not consider the actual costs of all tasks, which may misrepresent the overall expenditure in circumstances where outliers are relevant.

### Trade-offs
1. **Representation of Data**: 
   - The mean provides a comprehensive view, but can distort the understanding in the presence of outliers.
   - The median emphasizes the central tendency of the majority, but might overlook significant but rare costs.

2. **Stakeholder Interpretation**:
   - Stakeholders may prioritize different aspects. In budgets or financial summaries, the mean might be favored for thoroughness.
   - In operational contexts where consistency matters, the median can showcase reliable performance.

### Conclusion
- **Choose Median**: When data is skewed or contains significant outliers.
- **Choose Mean**: When the distribution is uniform and you need a complete overview of total costs.

### prose=full (253 mean output tokens)

**Mean Cost**:
- Represents the average cost per task.
- Sensitive to outliers or extreme values. Large costs can skew the average.
- More suitable when data has a normal distribution.

**Median Cost**:
- Represents the middle value, which divides the dataset into two equal halves.
- Less sensitive to outliers; provides a better representation of typical costs when the data has significant variability or is skewed.
- Useful when the distribution is not normal or when extreme values could misrepresent typical performance.

**Trade-offs**:
- **Mean** gives a single-point summary but may mislead if outliers are present.
- **Median** provides robustness against extreme values but may not reflect the overall cost trend.

**When to Use Each**:
- Use **Mean** when data is symmetrical and outliers are minimal.
- Use **Median** in skewed distributions or when you expect significant outliers that could distort the mean.

## tradeoff-temp0-vs-repeats (trade-off / tune)

### prose=off (437 mean output tokens)

To compare setting `temperature=0` versus averaging over `N > 1` repeats for stable token-count measurements, consider the following:

### Temperature = 0
- **Use Case**: 
  - When deterministic output is preferred.
  - The model generates the same output for identical inputs, which helps in consistent measurements.
- **Impact**:
  - Reduces variability caused by randomness in output since it always chooses the highest probability token.
- **Limitations**:
  - This approach may produce less creative or diverse outputs, limiting exploration of the model's capabilities.

### Averaging Over N > 1 Repeats
- **Use Case**:
  - When assessing variability and average performance across multiple runs.
  - Suitable for capturing a distribution of outputs for a given input.
- **Impact**:
  - Provides more representative metrics by smoothing out random fluctuations in individual outputs.
- **Limitations**:
  - Increases computation time because multiple executions are required.
  - If different outputs lead to vastly different token counts, this may not resolve systematic biases in generation.

### When to Use Both
- **Scenario**:
  - **To Achieve Both Stability and Exploration**: If the model's behavior is expected to vary widely due to performance, using `temperature=0` can yield stable outputs for baseline measurements. Averaging over `N` repeats can then capture any nuances in performance as conditions or input types change.
- **Objective**:
  - When aiming for reliable benchmarking while still understanding variability, using both approaches can highlight consistent patterns across runs without being affected by random noise.

### Conclusion
- **Temperature = 0** enhances consistency but sacrifices diversity.
- **Averaging over N > 1 repeats** allows insight into variability and provides a more nuanced understanding of model performance, especially in scenarios where unpredictability is a factor. Combining both approaches is beneficial when evaluating models in contexts requiring precise measurements and understanding their behavior in non-deterministic environments.

### prose=full (276 mean output tokens)

- **Temperature = 0**:
  - **Purpose**: Reduces randomness; produces deterministic output.
  - **When to Use**:
    - For exact reproducibility.
    - When randomness is undesirable.
    - Ideal for tasks requiring consistent answers (e.g., factual tasks).

- **Averaging over N > 1 Repeats**:
  - **Purpose**: Mitigates variance; smooths out noise in outputs.
  - **When to Use**:
    - When outputs vary due to inherent randomness (e.g., creative tasks).
    - Helps achieve more reliable estimates in stochastic settings.
    - Useful in high variability contexts.

- **When Both Are Needed**:
  - Situations requiring both consistency and reliability.
  - When assessing stability of outputs under varied initial conditions, where both approach ensures minimal variance and reproducibility.

- **Summary**:
  - Use **temperature = 0** for determinism.
  - Use **averaging** for reducing output variance.
  - Both used together for robustness in varying contexts.

## risk-cave-always-on (risk-enumeration / tune)

### prose=off (556 mean output tokens)

Running cave-mode (terse-prose styling) always-on in production for a coding agent poses several risks. Here’s a breakdown of potential failure modes and their impacts:

1. **User Miscommunication:**
   - **Failure Mode:** Incomplete or overly terse responses may lead to misunderstandings regarding code functionality or requested tasks.
   - **Impact:** Developers could implement incorrect solutions, leading to bugs or system failures.

2. **Reduced Clarity in Documentation:**
   - **Failure Mode:** Lack of detailed explanations may result in insufficiently documented code.
   - **Impact:** New team members or users may struggle to understand the codebase, increasing onboarding time.

3. **Loss of Context:**
   - **Failure Mode:** Important nuances or context may be omitted in terse outputs, diminishing the value of guidance.
   - **Impact:** This could frustrate users seeking comprehensive assistance, potentially leading to misuse of features.

4. **Inadequate Error Handling:**
   - **Failure Mode:** Minimalistic error messages might not convey enough information for debugging.
   - **Impact:** Developers may face challenges in troubleshooting, increasing downtime in production systems.

5. **Decreased User Engagement:**
   - **Failure Mode:** Continuous terse communication may alienate users who prefer more relatable or supportive interactions.
   - **Impact:** Reduced satisfaction could lead to decreased usage or abandonment of the tool.

6. **Severely Limited Educational Value:**
   - **Failure Mode:** Users may miss out on learning opportunities typically provided through elaborate explanations.
   - **Impact:** The overall skill level of the team may stagnate, hindering future development capabilities.

7. **Isolation of Critical Information:**
   - **Failure Mode:** Important warnings or notes may be overlooked due to the terse format, especially in complex scenarios.
   - **Impact:** Ignoring critical information can lead to severe application failures or security vulnerabilities.

8. **Inflexibility in User Interaction:**
   - **Failure Mode:** The terse style may not accommodate complex or conversational queries effectively.
   - **Impact:** Users may feel frustrated when trying to express complicated thoughts, leading to poor user experience.

9. **Potential Misinterpretation of Commands:**
   - **Failure Mode:** Brief commands or prompts might be misinterpreted by the agent, leading to unintended outcomes.
   - **Impact:** Wrong decisions may harm the project’s integrity and productivity.

10. **Reduced Collaboration:**
    - **Failure Mode:** A terse communication style may limit collaborative discussions and brainstorming.
    - **Impact:** Team cohesiveness could suffer, impeding effective problem-solving and innovation.

In summary, while terse prose can streamline communication in some contexts, the consistently automated application of cave-mode in a production coding agent may lead to a range of risks that primarily affect developers, team functionality, and overall project integrity.

### prose=full (352 mean output tokens)

- **Miscommunication**: Key points may be overlooked; users miss critical information.  
- **Ambiguity**: Technical details may be unclear, leading to misinterpretation.  
- **Errors in Context**: Key context lost; potential for incorrect implementation, impacting code quality.  
- **Reduction in Collaboration**: Less collaborative or friendly tone may hinder teamwork and user engagement.  
- **Increased Frustration**: Users could feel unsupported or frustrated, affecting user retention.  
- **Compliance Issues**: Lack of clarity might lead to non-compliance with coding standards, harming project integrity.  
- **Loss of Audience**: Beginners or less technical users might find interactions inaccessible, reducing user base.  
- **Debugging Difficulty**: Terseness can complicate understanding in error messages, prolonging resolution time and hurting productivity.  
- **Support Burden**: Increased requests for clarifications or support, straining resources.

## trace-reduction-null-baseline (multi-step-trace / tune)

### prose=off (360 mean output tokens)

To trace the function `outputReductionPct(outputOff, outputFull)` step-by-step when `outputOff` is 0, I'll need to read the implementation of that function. Let me locate it in the codebase and analyze it. I'll start by searching for the definition of `outputReductionPct`.

### prose=full (365 mean output tokens)

To trace the function `outputReductionPct(outputOff, outputFull)` with `outputOff` set to `0`, we'll analyze the steps involved in the function's execution, considering the nuance of how the return value is generated and its implications for callers like "the aggregate" and "the table."

### Steps in `outputReductionPct(outputOff, outputFull)`

1. **Input Parameters**:
   - `outputOff = 0`
   - `outputFull` (assumed positive based on context, otherwise further context is needed).

2. **Calculate Reduction Percentage**:
   - The formula typically used is:
     ```
     reduction = (outputFull - outputOff) / outputFull * 100
     ```
   - With `outputOff` being `0`, the calculation simplifies to:
     ```
     reduction = (outputFull - 0) / outputFull * 100
                = outputFull / outputFull * 100
                = 1 * 100
                = 100
     ```

3. **Return Value**:
   - The function will return `100` as the reduction percentage.

### Implications for Callers

- **The Aggregate**:
  - Likely uses this value to understand the overall reduction in output across a dataset or operation.
  - With a return value of `100`, it infers total effectiveness or similarity, indicating that the output is completely reduced (since `outputOff` represents complete shutdown or zero output).

- **The Table**:
  - May display this percentage in a UI component or report.
  - A `100%` reduction typically indicates no output being generated, which could trigger different internal logic, such as logging warnings/errors about performance or potentially classify it as 'non-functional'.

### Summary

- **Returns**: `100`
- **Why**: Total output is fully reduced due to `outputOff` being `0`.
- **Impact**: Both the aggregate and table utilize this value to convey complete reduction, affecting visualization or operational decision-making based on performance or outcomes in processing.

## factual-temp0-meaning (short-factual / tune)

### prose=off (43 mean output tokens)

Setting an LLM sampling temperature to 0 makes the model deterministic, meaning it will always produce the same output for a given input, favoring the highest-probability response and eliminating randomness.

### prose=full (40 mean output tokens)

Setting an LLM sampling temperature to 0 makes the model deterministic, causing it to always generate the same output for a given input. The model chooses the most probable token at each step, eliminating randomness and variability.
