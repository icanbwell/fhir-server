---
name: iterative-investigation
description: Deep-debug production bugs using iterative hypothesis-driven tracing. Follows symptoms through code paths layer by layer until 100% root cause confidence, then uses TDD to fix. Designed for Java/Spring/Kafka/FHIR microservice architecture.
argument-hint: "<symptom or execution ID> — e.g. 'execution abc123 stuck in BUNDLING', 'personCount:0 but persons are bundled', 'Kafka lag spike on normalizer'"
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Edit, Agent
---

# Iterative Investigation Skill

Deep-debug production bugs by iteratively tracing through code paths, forming and verifying hypotheses at each layer, achieving 100% root cause confidence, and implementing a TDD fix.

## Core Principles

1. **Never accept the first explanation** — go deeper until you can explain WHY
2. **Each iteration narrows scope by 50%+** — every round eliminates half the possibility space
3. **Trace BOTH the happy path AND the failing path** — the divergence IS the bug
4. **Verify every hypothesis with evidence** — code trace, log query, DB query, or test
5. **100% confidence gate** — do NOT propose a fix until you can prove the bug exists with a reproducing test
6. **Minimal fix** — change the least amount of code that makes the failing test pass

## Anti-Patterns to Avoid

- Guessing at the fix based on symptoms alone
- Fixing without a reproducing test (you will fix the wrong thing)
- Surface-level analysis ("oh the config is wrong") without explaining the mechanism
- Expanding scope prematurely before exhausting the current layer
- Conflating correlation with causation in logs
- Assuming the bug is in the code you are looking at (it may be upstream)
- Reading only the failing path without understanding the happy path first
- **⚠️ BEWARE: Stopping at symptom confidence and declaring 100% root cause** — See INE-816 cautionary example below
- Declaring an external/upstream system (FHIR server, Kafka, another service) "broken" without first reading its contract — its sort order, its cursor semantics, its documented behavior. The boundary may be correct and YOUR layer may be overriding it.
- "Fixing" a symptom by ADDING a compensating layer on top of behavior you've labeled "wrong but unchangeable," when the real fix is to DELETE code and align with the existing contract. A root-cause fix often has a negative line count.

**Critical Anti-Patterns (Code Reading vs. Reality):**
- ❌ Declaring confidence based only on reading code, without asking the user for actual data
- ❌ Saying "the code does X" without verifying X actually happens with real data
- ❌ Assuming a field has value Y without showing its actual value from logs/Kafka/API responses
- ❌ Tracing a code path from A→B→C without confirming that data actually flows that way
- ❌ Reading code that extracts field X and assuming the source always has field X (it might not)
- ❌ Saying "100% confident" without evidence from Phase 2.5 bridge—code understanding alone is insufficient

**Critical Anti-Pattern (Phase 1 Data Collection):**
- ❌ Skipping Phase 1 data collection and jumping straight to code tracing
- ❌ Assuming you understand the problem without seeing real examples
- ❌ Saying "I'll trace code and verify against data later" — reverse the order
- ❌ Treating the user's description as complete instead of asking "show me an actual example"
- ❌ Going 2+ iterations into Phase 2 before asking "can I see the actual data from your system?"

**The fix:** Ask for real data immediately in Phase 1. Answer is usually there.

**Critical Anti-Pattern (Workaround Masquerading as a Fix):**
- ❌ "The [server/upstream] emits the wrong X; I'll correct it on our side" — before proving the upstream contract is actually violated, not just unfamiliar
- ❌ Writing "this is a client-side workaround; the proper fix is in [other system]; a separate ticket will track it." If you're deferring the "proper fix," you have NOT confirmed root cause — you've assumed it's unfixable. Stop and prove that first.
- ❌ A fix that only ADDS a translation/correction/normalization layer. Ask: "what if I DELETE the thing that's misbehaving instead of compensating for it?"

**The tell:** If your fix adds code to compensate for a boundary you've declared broken, verify the boundary's contract first. The bug is usually that something in YOUR layer is already overriding a correct contract. (Real case: INE-653 added 71 lines to "correct" a FHIR `next`-link cursor the server emitted correctly; INE-600 fixed the underlying paging failure by DELETING those 71 lines and aligning the query's sort with the server's cursor field. See case study below.)

---

## Phase 1: Symptom Collection + Real Data Inspection

**Goal:** Establish exactly what is broken, what the expected behavior is, and what the actual behavior is — AND collect real examples of the phenomenon from the production system.

### Actions

1. **Gather the observable facts** — What does the user/monitoring report? Error messages, stuck states, unexpected values.
2. **Define expected vs actual** — Be precise. "personCount should be 5 but is 0" not "it's broken."
3. **Establish timeline** — When did it start? Is it intermittent or consistent? What changed recently?
4. **Identify the affected scope** — One execution? One org? All orgs? One measure? All measures?

### CRITICAL STEP: Collect Real Examples Before Proceeding

**Do NOT proceed to Phase 2 (code tracing) until you have actual data examples.** Many bugs are visible in the data and invisible in the code.

Based on the problem type, ask the user for:

**If about event data:**
- "Show me actual examples of [event type] from Kafka or logs"
- Get 2-3 examples showing the problem
- Example: "Show me actual directActionTaskReady events for both connectionFound and connectionFixed workflows"

**If about resource data:**
- "Show me actual FHIR resources that exhibit this problem"
- Get the JSON or XML, not just a description
- Example: "Show me the actual ActivityDefinition JSON for both workflows"

**If about state/data inconsistency:**
- "Show me the actual values in the database/system"
- Query results, API responses, current state
- Example: "What does the Task resource actually contain for this scenario?"

**If about counts/metrics:**
- "What are the actual numbers from your system right now?"
- Not hypothetical, actual measurements
- Example: "What are the actual values you're seeing for personCount?"

**If about queries/filters:**
- "Show me the actual query results or logs"
- Prove the hypothesis with real output
- Example: "What does Groundcover actually show for this execution?"

### Why This Step Is Critical

Code reading and reality diverge at boundaries:
- Code may extract field X, but actual JSON doesn't have X
- Both paths look different in code but produce same output
- Field is optional and null 50% of the time
- Serialization/deserialization changes values

**The answer is often in the data, not the code.**

### Evidence Sources

- **Production logs** — actual error messages, actual values, actual behavior
- **Kafka** — actual events flowing through the system right now
- **FHIR server** — actual resource JSON, actual values
- **Groundcover** — actual logs with actual field values
- **Database queries** — actual data in the system
- **API responses** — actual values returned
- **Screenshots/exports** — what the user is actually observing

### Output of Phase 1

A clear problem statement WITH real examples:

```
EXPECTED: [precise expected behavior]
ACTUAL: [precise actual behavior, with real examples from prod]
REAL EXAMPLES:
  - Event 1: [actual JSON/data showing the problem]
  - Event 2: [actual JSON/data showing the problem]
  - Relevant data: [what the user showed you]
SCOPE: [what is affected]
TIMELINE: [when it started, frequency]

PRELIMINARY OBSERVATIONS FROM REAL DATA:
  - [What the actual data shows about the problem]
  - [Does it match the user's description?]
  - [What's surprising or different from expected?]
```

**Do not proceed to Phase 2 until you have this data in hand.**

### Phase 1 Data Collection: Query It Yourself

Instead of asking the user to provide data, **query production systems yourself** using the credentials they provide. This lets you discover the answer directly rather than relying on the user's extraction.

**Step 1: Request Access Credentials**

Ask the user for credentials to access:
- FHIR server (fhir.staging.bwell.zone or prod)
- Kafka/Groundcover (for event logs)
- Database (if direct queries needed)
- Any other system relevant to the problem

Example: "Can you provide credentials for fhir.staging.bwell.zone so I can query the ActivityDefinitions directly?"

**Step 2: Query the Data Yourself Based on Problem Type**

**For "does field X distinguish Y" questions:**
- Query both resources from FHIR server
- Compare actual JSON side-by-side
- Example: GET /ActivityDefinition?[search params] for both connection types, inspect code.coding values directly

**For event/data flow questions:**
- Query Groundcover or Kafka for actual events
- Pull 3-5 real examples showing both cases
- Example: Search Groundcover for directActionTaskReady events for both workflows, see what's actually in them

**For state/data inconsistency questions:**
- Query the current resource state from FHIR server
- See actual field values in production
- Example: GET /Task/{id} to see what fields actually contain

**For counts/metrics questions:**
- Run Groundcover queries or database queries
- Get real measurements, not hypothetical
- Example: Query actual personCount values from logs

**Step 3: Inspect the Data**

Look at the actual JSON, values, and structure. Many times the answer is immediately obvious once you see the real data.

### Safety Constraint (CRITICAL)

When querying production:
- ✓ READ-ONLY operations only
- ✓ Inspecting data, logs, events
- ✓ Running queries to see what exists
- ✓ Examining FHIR resources
- ✗ NEVER modify, create, update, or delete resources
- ✗ NEVER trigger actions or changes as part of this investigation
- ✗ NEVER write to any system

**If you discover you need to modify data to test something, STOP. Ask permission first and wait for user approval.**

**Before saying "I need to trace code":**
- [ ] Have I requested the credentials I need?
- [ ] Have I queried the actual production data myself?
- [ ] Have I inspected 3+ real examples directly?
- [ ] Could the answer be visible in the real data without code tracing?
- [ ] Does the actual data match what the user described?

If the answer to any is "no," query the data first.

---

## The Most Important Gate: Phase 1 Data Collection

**Insight from recent mistakes:** I skipped Phase 1 data collection and jumped to code tracing. This wasted hours and led to false confidence.

**Why Phase 1 data matters most:**
- Most bugs are visible in the actual data
- Code tracing is necessary when data is ambiguous
- Querying data yourself finds the answer 10x faster than code reading
- False confidence comes from code reading without data verification

**The pattern (slow):**
```
Investigation that takes 2+ hours:
1. Read code
2. Make inferences about what data contains
3. Declare confidence based on code reading
4. User corrects with actual data
5. Theory collapses
```

**The pattern (fast):**
```
Investigation that takes 5 minutes:
1. Request credentials to prod systems
2. Query the actual data yourself
3. Inspect actual JSON/values
4. Answer is usually visible in the data
5. Done (maybe no code tracing needed at all)
```

**How to recognize when you're about to skip Phase 1:**
- Your first instinct is "let me read the code"
- You haven't asked "can you provide credentials so I can query this?"
- You're making inferences about what data contains instead of querying to see it
- You're saying "the code should do X" instead of "let me query production to see what actually happens"
- You're about to proceed to Phase 2 without having seen actual production data

**Stop.** Query production data first. Code second.

---

## Phase 1 Production Access: Read-Only Safety Rules

Since you have provided production credentials, this skill enables me to query production systems directly. **This makes investigations much faster, but it requires strict safety rules.**

### What I Will Do
- ✓ Query FHIR server to fetch resources (GET)
- ✓ Query Groundcover for logs and metrics
- ✓ Query Kafka topics for event inspection
- ✓ Run read-only database queries if needed
- ✓ Search, list, and inspect all kinds of data
- ✓ Examine production state to understand the problem

### What I Will NEVER Do
- ✗ Create resources (POST)
- ✗ Update resources (PUT/PATCH)
- ✗ Delete resources (DELETE)
- ✗ Modify configuration or state
- ✗ Trigger workflows or actions
- ✗ Write to any system
- ✗ Change any production data

### Exception: Testing Fixes

If Phase 4 (Reproduction) or Phase 5 (TDD Fix) requires creating test data in production:
1. **STOP and ask permission first**
2. Get explicit approval from the user
3. Describe exactly what I will create/modify
4. Wait for user confirmation
5. Only then proceed with modifications
6. Clean up any test data afterward

**This skill is READ-ONLY by default. Modification requires explicit user approval.**

---

## Phase 2: Iterative Trace

**Goal:** Follow the code path from trigger to symptom, narrowing scope each round until you find the exact line/condition that diverges.

### Method: Peel-the-Onion Iterations

Each iteration follows this structure:

**PART A: REPORT ON PREVIOUS ITERATION (if not first iteration)**

Display the **Iteration Summary Report** from the last iteration:

```
## Iteration N Summary Report

### Assumptions from Previous Iteration (Iteration N-1):

| Assumption | Check Performed | Evidence Found | Status | Impact |
|---|---|---|---|---|
| [Previous assumption 1] | [What I checked] | [What I found] | ✓ HELD / ✗ DISPROVEN / ⚠️ INCONCLUSIVE | [Did it narrow scope?] |
| [Previous assumption 2] | [What I checked] | [What I found] | ✓ HELD / ✗ DISPROVEN / ⚠️ INCONCLUSIVE | [Did it narrow scope?] |
| ... | | | | |

### What This Iteration Revealed:
- ✓ Confirmed findings: [Specific discoveries]
- ✗ Disproven theories: [What we ruled out]
- ⚠️ Inconclusive: [What needs more data]
- 🎯 Scope narrowed from [X possibilities] to [Y possibilities]

### Hypothesis Evolution:
- **Iteration 1 hypothesis:** [Original theory]
- **Current hypothesis (Iteration N):** [How it evolved]
- **Rejected paths:** [Dead ends we ruled out]

### Confidence Trajectory:
- Iteration 1: LOW (many unknowns)
- Iteration N: MEDIUM/HIGH (X of Y key assumptions confirmed)
- Next blocker: [What would increase confidence further]
```

**Stop here.** You review. You can say:
- "That finding is wrong, here's what actually happened"
- "I have evidence that contradicts that"
- "Let me show you what I found"

**PART B: DISPLAY NEW ASSUMPTIONS (START OF CURRENT ITERATION)**

Create a fresh table for this iteration so you can review before I proceed:

```
## Current Assumptions (Iteration N):

| Assumption | Source (code/inference) | Previous Iteration Status | Will Validate By |
|---|---|---|---|
| [Assumption 1] | Code line X or inference | New / Refined from Iteration N-1 | [Specific check] |
| [Assumption 2] | Inference from Y | Carries forward from N-1 | [Specific check] |
| ... | | | |

**Next, I will:** [List specific actions to take]

**Questions for you before proceeding:**
- Do any of these assumptions look wrong based on your knowledge?
- Do you have evidence that contradicts any of these?
```

**Stop here.** Wait for your feedback. If you say assumptions look wrong, incorporate that immediately.

**PART C: TRACE, CHECK, EVALUATE, DECIDE (CONTINUE IF VALIDATED)**

1. **State current hypothesis** — "I believe the bug is in [component] because [evidence from Part A]"
2. **Design a check** — What specific thing would confirm or refute assumptions from Part B?
3. **Execute the check** — Read code, query logs, inspect data
4. **Evaluate result** — For each assumption: ✓ HELD / ✗ DISPROVEN / ⚠️ INCONCLUSIVE
5. **Decide next step** — Go deeper into this component, or pivot to another
6. **Loop to next iteration** — Go back to PART A and report findings

### Tracing Patterns for Our Architecture

#### FSM Guard Tracing (Orchestrator)
The orchestrator uses a Spring State Machine. State transitions are guarded:
```
State A --[event]--> Guard evaluates --> State B (or stays in A)
```
- Read the guard condition in `StateMachineConfig` or `*Guard.java`
- Trace what data the guard reads (usually from `ExecutionContext` or the DB)
- Check if the guard's precondition can silently fail (return false without logging)

#### Kafka Event Flow Tracing
```
Producer (publishes event) --> Topic --> Consumer (processes event)
```
- Check: Was the event published? (producer logs, topic offset)
- Check: Was the event consumed? (consumer group lag, consumer logs)
- Check: Did the consumer process it successfully? (application logs, state change)
- Key diagnostic: If lag is 0 but no state change, the consumer processed and DROPPED the event (look at filtering/routing logic)

#### Async/Reactive Pattern Tracing
- `@Async` methods swallow exceptions unless the caller checks the Future
- `@TransactionalEventListener` fires AFTER commit — if the transaction rolled back, the event never fires
- `@KafkaListener` with manual ack — if ack is never called, the message is redelivered (but only after session timeout)

#### FHIR Query Tracing
- Check the query parameters being sent (not what you THINK is sent)
- Check if `_count` pagination is cutting off results
- Check if security labels / access scopes are filtering unexpectedly
- ProxyPatient (`Patient/person.{id}`) resolves to linked Patients — check Person links exist

### Assumption Log (REQUIRED)

At the start of Phase 2, create an explicit list of assumptions you're making about how the code works. Before proceeding to Phase 3, you must verify each assumption against real data/logs/examples. **Do not skip this step.**

Example:
```
ASSUMPTIONS:
1. ActivityType field contains the connection type value (NEEDS VERIFICATION)
2. This field is extracted from ActivityDefinition.code.coding (NEEDS VERIFICATION)
3. The field flows unchanged through TaskChangeEvent (NEEDS VERIFICATION)
4. Both workflows produce different values (NEEDS VERIFICATION)

EVIDENCE FOR EACH:
1. [Ask user for actual ActivityDefinition JSON for both workflows]
2. [Check actual code path with real data, not just code reading]
3. [Trace actual Kafka message, not just code flow]
4. [Show actual event in hp-notification-service, not hypothetical]
```

### When to Expand Scope

Expand scope (go upstream) when:
- The component you are investigating is behaving correctly given its inputs
- The inputs to this component are wrong/missing/stale
- The bug is in the data, not the code (then trace who wrote the bad data)

Expand scope (go downstream) when:
- The component produces correct output but the next stage misinterprets it
- A serialization/deserialization boundary corrupts the data

### Groundcover Query Patterns

```
# Trace a specific execution through orchestrator
* | filter workload:clinical-reasoning-orchestrator-service content:"{EXEC_ID}" | sort by (_time desc) | limit 100

# Find errors in a time window
* | filter workload:{SERVICE} level:error | filter _time >= now() - 1h | sort by (_time desc) | limit 50

# Trace a Kafka message by correlation ID
* | filter content:"{CORRELATION_ID}" | sort by (_time asc) | limit 100

# Find state transitions
* | filter workload:clinical-reasoning-orchestrator-service content:"transition" content:"{EXEC_ID}" | sort by (_time asc)
```

### Kafka Lag as a Diagnostic Signal

| Lag Pattern | Meaning |
|---|---|
| Lag = 0, no state change | Consumer received and DROPPED the message (filter/routing bug) |
| Lag growing steadily | Consumer is slower than producer (throughput issue, not a bug) |
| Lag stuck at N > 0 | Consumer is stuck/crashed/in rebalance |
| Lag spikes then recovers | Temporary processing delay (pod restart, GC pause) |
| Lag = 0 across all groups | No messages being produced (upstream is the problem) |

---

## Phase 2.5: Evidence Collection & Assumption Verification

**Goal:** Bridge the gap between code reading and actual system behavior. This phase prevents confident claims that are based only on how code *looks* rather than how it *actually behaves*.

### Why This Phase Exists

Code reading and actual behavior can diverge:
- You read code that extracts field X, but the actual ActivityDefinition doesn't have field X
- Code paths look connected in isolation but serialization/deserialization corrupts data in reality
- You assume a field is "always set" but logs show it's null 50% of the time

**You cannot declare 100% confidence without crossing this bridge.**

### Actions (Required Before Phase 3)

**Step 1: Retrieve Assumptions Table**

Pull the assumptions table from the most recent Phase 2 iteration. This is what gets validated.

**Step 2: Request Real System Evidence for Each Assumption**

For each assumption in the table, ask you for concrete examples:

```
To validate these assumptions, I need to see:

1. [Assumption 1]: Please show me [specific actual system output: log, event, JSON, metric]
2. [Assumption 2]: Please show me [specific actual system output]
...

Without these, I cannot proceed to Phase 3.
```

**Step 3: Validate Against Real-World Data**

For each assumption, cross-check against the evidence you provide:

- If evidence matches assumption: ✓ VERIFIED
- If evidence contradicts assumption: ✗ REJECTED
- If evidence is unclear: ❓ INCONCLUSIVE (ask follow-up questions)

**Step 4: Create Validation Report**

Produce a report table showing findings:

```
## Phase 2.5 Assumption Validation Report

| # | Assumption | Evidence Provided | Finding | Confidence Impact |
|---|---|---|---|---|
| 1 | [Assumption 1] | [What you showed me] | ✓ VERIFIED / ✗ REJECTED / ❓ INCONCLUSIVE | Confidence: [HIGH/MEDIUM/LOW] |
| 2 | [Assumption 2] | [What you showed me] | ✓ VERIFIED / ✗ REJECTED / ❓ INCONCLUSIVE | Confidence: [HIGH/MEDIUM/LOW] |
| ... | | | | |

**Summary:** 
- X assumptions verified
- Y assumptions rejected (requires Phase 2 revision)
- Z assumptions inconclusive (need more evidence)

**If any assumptions rejected:** Return to Phase 2. Do not proceed to Phase 3.

**If all assumptions verified or inconclusive is acceptable:** Proceed to Phase 3.
```

**Step 5: Explicitly List What Remains Unverified**

```
UNVERIFIED ELEMENTS (acceptable to proceed with caveats):
- [Element 1] — could not get evidence, but low criticality
- [Element 2] — evidence inconclusive, but X still holds

DEAL-BREAKERS THAT WOULD BLOCK PHASE 3:
- Any assumption marked ✗ REJECTED
- Any critical assumption marked ❓ without clear resolution
```

### When to Block Phase 3

Do NOT proceed to Phase 3 confidence gate if:
- [ ] You've assumed a field is present without seeing it in actual data
- [ ] You've traced a code path but not verified the data actually flows that way
- [ ] You've said "the code does X" without showing an example where X happens
- [ ] You haven't asked the user for real examples from their system

**If blocked:** Go back to Phase 2 and narrow further, OR ask the user for actual system evidence.

---

## Phase 3: Root Cause Confirmation

**Goal:** Achieve 100% confidence in the root cause with concrete evidence.

### Confidence Checklist

You are at 100% confidence when ALL of these are true:

**Code Understanding (not sufficient alone):**
- [ ] You can point to the exact line(s) of code that cause the bug
- [ ] You can explain the mechanism: why does this line produce wrong behavior?
- [ ] You can explain why it works in the happy path but fails in the bug path
- [ ] You can predict: "if I change X, behavior Y will change to Z"

**Behavior Verification (REQUIRED—you cannot skip this):**
- [ ] You have VERIFIED with actual system evidence that the bug exists (not just code reading)
- [ ] You can point to actual logs/data/metrics showing the wrong behavior
- [ ] You've shown the actual data structure (JSON, log line, metric value) that proves your theory
- [ ] If your hypothesis depends on a field having a specific value, you've shown that field's actual value from the real system
- [ ] You've explicitly checked your assumptions against real data and found NO contradictions

**Disqualifiers—if any of these are true, you are NOT at 100% confidence:**
- You've read code but haven't verified the actual data matches your understanding
- You've assumed a field exists without seeing it in real data
- You've said "should" or "probably" instead of "is" based on logs/data
- You've traced code paths without confirming the data actually flows that way
- You haven't asked the user for real system evidence
- You've concluded an external system is "broken" without reading its actual contract (sort order, cursor field, documented semantics) and confirming YOUR layer isn't overriding it
- Your proposed fix ADDS a compensating layer rather than removing a defect — and you haven't asked whether deleting/aligning would be simpler
- You're planning to file a "separate ticket for the proper fix" — meaning you have a workaround, not a root cause

### Causality Depth Check — Don't Get Trapped by Symptom Confidence

**⚠️ THE TRAP:** You can point to an exact line of code that causes the bug. You understand why it fails. You have 100% confidence. **But you've only found the symptom, not the root cause.**

**How this trap catches you:**

1. Investigation identifies: "The guard doesn't exclude PENDING persons, so the expected count inflates"
2. You point to the exact line in `BundlingCountResolver.getTotalPersonCount()`
3. You declare: "100% confident — the guard logic is broken"
4. You implement the symptom fix: exclude PENDING from the count
5. **You miss:** Why do PENDING stragglers exist in the first place? (Hibernate ORM returns stale cached entity when a pessimistic lock re-check runs)

**Real example:** INE-816 investigation could have stopped at "exclude PENDING from guard count" (symptom) instead of asking "why do stragglers exist?" (root cause). Two valid solutions, very different scope:
- **PR #157 (symptom fix):** 1 file changed, pragmatic, doesn't prevent recurrence
- **PR #160 (root cause):** 17 files changed, uses CAS gates, makes the condition impossible

See `docs/superpowers/case-studies/INE-816-symptom-vs-root-cause.md` for the full cautionary tale.

---

### How to Avoid the Trap: Causality Depth Questions

After you've identified the immediate cause and declared preliminary confidence, **stop and ask these four questions before Phase 4:**

1. **"Is this condition preventable, or is it inevitable?"**
   - If YES (preventable): Go deeper. Don't stop here.
   - If NO (inevitable): This is the root cause. Proceed to Phase 4.

2. **"Trace back: What operation creates this condition?"** 
   - Stragglers exist → Who creates them? → Why doesn't the add-gate prevent it? → **Hibernate cache returns stale entity** (root cause found)

3. **"Compare the two solutions I could implement:"**
   - **Symptom fix:** Make downstream resilient to the condition (e.g., "ignore PENDING rows")
     - Pros: Smaller change, pragmatic for production fires
     - Cons: Tolerates a condition that shouldn't happen; may hide future regressions
   - **Root-cause fix:** Prevent the condition entirely (e.g., "use atomic CAS gates")
     - Pros: Architecturally clean, prevents recurrence, removes the trap for future developers
     - Cons: Larger change, more invasive, longer to implement

4. **"Which should I implement, given the context?"**
   - **Production on-fire scenario:** Deploy symptom fix NOW to stabilize, then plan root-cause fix as follow-up
   - **Planned architectural work:** Implement root-cause fix; the urgency is lower, the quality bar is higher
   - **Either way:** Document both approaches in the PR so the trade-off is intentional and visible to reviewers

---

### Common Root Cause Patterns in Our Architecture

| Pattern | Example |
|---|---|
| Silent guard failure | Guard returns `false` without logging, blocking state transition |
| Race condition in async | Two Kafka consumers update the same entity, last-write-wins |
| Off-by-one in count | `personCount` set from query result before filtering, actual != expected |
| Stale cache | `ActivityDefinition` cache returns old version after update; **ORM returns cached entity instead of reading fresh committed state** (INE-816) |
| Missing null check | Optional field absent in FHIR resource, NPE in processing |
| Wrong query scope | Query uses `_count=100` but org has 150 persons |
| Serialization mismatch | Kafka message schema v2 consumed by v1 deserializer |
| Transaction boundary | DB write committed but Kafka publish in same tx rolls back (or vice versa) |

---

## Phase 4: Reproduction

**Goal:** Write a failing integration test that demonstrates the bug exists.

### Test Structure

Always use the `// GIVEN // WHEN // THEN` format:

```java
@Test
void shouldHandleSpecificBugCondition() {
    // GIVEN — set up the exact conditions that trigger the bug
    // (use the minimum data needed to reproduce)

    // WHEN — trigger the action that exposes the bug

    // THEN — assert the CORRECT behavior (test FAILS before fix)
}
```

### Reproduction Strategy

1. **Identify the minimal reproduction** — What is the smallest input that triggers the bug?
2. **Write the test at the right level** — Integration test if it crosses boundaries, unit test if it is pure logic
3. **Name the test descriptively** — `shouldNotResetPersonCountWhenBundlingCompletes` not `testBug123`
4. **Assert the CORRECT behavior** — The test must FAIL on the current code and PASS after the fix

### Where to Put the Test

- Logic bug in a service method: unit test in the same module
- Bug in Kafka event handling: integration test with embedded Kafka
- Bug in FSM transition: integration test with Spring State Machine test support
- Bug in FHIR query construction: unit test mocking the FHIR client
- Bug spanning multiple services: E2E test in `hp-validation-tests` repo

### Verify the Test Fails

Run the test and confirm it fails for the RIGHT reason:
- The assertion should fail (not a setup error, not a compilation error)
- The failure message should clearly indicate the bug behavior

---

## Phase 5: TDD Fix

**Goal:** Make the failing test pass with the minimal code change.

### Process

1. **Run the failing test** — confirm it fails (red)
2. **Implement the minimal fix** — change only what is necessary
3. **Run the test again** — confirm it passes (green)
4. **Run the full test suite** — confirm no regressions
5. **Refactor if needed** — clean up without changing behavior (refactor)

### Fix Quality Checklist

- [ ] Fix addresses the root cause, not a symptom
- [ ] Fix does not change behavior for the happy path
- [ ] Fix handles edge cases (null, empty, concurrent)
- [ ] Fix includes appropriate logging (so future debugging is easier)
- [ ] Fix does not introduce a new silent failure mode
- [ ] All existing tests still pass

### Common Fix Patterns

| Root Cause | Fix Pattern |
|---|---|
| Silent guard failure | Add explicit logging on guard failure + fix the guard condition |
| Race condition | Add optimistic locking or idempotency check |
| Wrong count | Move the count assignment to after filtering |
| Stale cache | Add cache invalidation trigger or TTL |
| Missing null check | Add null guard with appropriate default/skip behavior + log |
| Wrong query scope | Fix pagination or remove artificial limit |

---

## Phase 6: Documentation

**Goal:** Create a durable record of the investigation for future reference.

### Investigation Document Template

Create a markdown file in the project memory or repo docs:

```markdown
# [Ticket ID] [Brief Description]

## Symptom
What was observed. Include specific values, timestamps, affected scope.

## Timeline
- [timestamp] Symptom first reported
- [timestamp] Key investigation milestones
- [timestamp] Root cause identified
- [timestamp] Fix implemented and verified

## Root Cause
Precise technical explanation. Include:
- The exact code path that fails
- Why it fails (the mechanism)
- Why it only fails under specific conditions
- Why it was not caught by existing tests

## Fix
- What was changed (file, line, logic)
- Why this fix is correct
- What the failing test asserts

## Lessons Learned
- What made this bug hard to find?
- What monitoring/logging would have caught it sooner?
- Are there similar patterns elsewhere that need the same fix?
```

### Memory Updates

After the investigation, update project memory with:
- The root cause pattern (so it can be recognized faster next time)
- Any new diagnostic queries that proved useful
- Any architectural insight gained

---

## Workflow Summary

```
Phase 1: Symptom Collection + Real Data Inspection
    |
    ├─ Ask clarifying questions
    ├─ Define expected vs actual
    └─ REQUEST REAL DATA EXAMPLES (MANDATORY)
        |
        | (BLOCKED until user provides actual data)
        | "Can you show me actual [events/resources/logs]?"
        |
        v
    (Answer often visible in data, Phase 2 may be unnecessary)
        |
        └─→ If data answers the question: Investigation complete
        |
        └─→ If data doesn't fully answer: Proceed to Phase 2
    |
    v
Phase 2: Iterative Trace (loop until narrow)
    |
    | (Each iteration: Summary Report → New Assumptions → Trace → Evaluate)
    |
    ├─→ Iteration 1:
    |   ├─ Summary Report: [Show confirmed/disproven from previous]
    |   ├─ New Assumptions Table [user reviews, can interject]
    |   └─ Trace/Evaluate/Report findings
    |       |
    |       └─→ (Scope narrowed? Continue) → Iteration 2
    |           |
    |           ├─ Summary Report: [Show what iteration 1 proved/disproved]
    |           ├─ New Assumptions Table [user reviews, can interject]
    |           └─ Trace/Evaluate/Report findings
    |               |
    |               └─→ (Scope narrow enough?) → Phase 2.5
    |
    v
Phase 2.5: Evidence Collection (MANDATORY bridge)
    |
    ├─ Retrieve assumptions from final Phase 2 iteration
    ├─ Request real system evidence for each
    ├─ Create Validation Report (✓/✗/❓)
    └─ BLOCKED if ✗ REJECTED → Return to Phase 2
    |
    v
Phase 3: Root Cause Confirmation (100% gate with real evidence)
    |
    v
Phase 4: Reproduction (failing test)
    |
    v
Phase 5: TDD Fix (make test pass)
    |
    v
Phase 6: Documentation
```

## Invoking This Skill

When the user reports a bug or stuck execution:

1. **Phase 1 (CRITICAL):** Start with symptom collection AND query production data yourself
   - Ask clarifying questions if vague
   - **MANDATORY:** Request credentials to access production systems (FHIR server, Kafka, Groundcover, etc.)
   - Query the data yourself using those credentials (READ-ONLY only)
   - Inspect actual JSON/data to see if the answer is visible
   - Do not proceed to Phase 2 until you've queried and inspected real production data
   - Real data often makes the answer obvious without needing code tracing
   - **Safety:** Only query/inspect. Never modify, create, update, or delete anything

2. **Phase 2:** Trace code iteratively in cycles:
   - **START OF EACH ITERATION:** Display Assumptions Table (user reviews, can interject)
   - **"Questions for you before I proceed?"** — Wait for feedback
   - If you say assumptions look wrong, incorporate that immediately
   - If you say "let me show you," provide evidence and integrate it
   - Then proceed: hypothesis → check → evaluate → decide
   - Loop until you've narrowed scope sufficiently

3. **Phase 2.5 (MANDATORY BRIDGE):** Validate all assumptions:
   - Display assumptions from Phase 2
   - Request specific evidence for each
   - Create Validation Report (✓ VERIFIED / ✗ REJECTED / ❓ INCONCLUSIVE)
   - If any assumption rejected: Return to Phase 2, do not proceed
   - If all verified or acceptable: Proceed to Phase 3

4. **Phase 3:** Explicitly declare 100% confidence only when:
   - Code understanding is complete (from Phase 2)
   - All critical assumptions are verified (from Phase 2.5)
   - Real system evidence corroborates hypothesis

5. **Phase 4:** Ask the user before writing the test — confirm the test location and approach

6. **Phase 5:** Implement the fix and run the full test suite

7. **Phase 6:** Offer to create the documentation

### Key Interaction Points (Where You Can Interject)

- **After each Assumptions Table:** Say "wait, that assumption is wrong" or "let me show you evidence"
- **At Phase 2.5:** Review the Validation Report. If you see ✗ REJECTED, we return to Phase 2
- **Before Phase 3 declaration:** Ask "are all the critical assumptions really verified?"

### Rules for This Skill

- **At START OF EACH PHASE 2 ITERATION:** Print assumptions table and wait for feedback
- **NEVER declare high confidence without Phase 2.5 validation.** Code reading alone is insufficient.
- **If assumptions are ✗ REJECTED in Phase 2.5:** Go back to Phase 2. Do not skip.
- **Explicit beats implicit.** Show the table, list the checks, report the findings. Don't hide your reasoning.

At any point:
> "I've listed my assumptions above. Do any of those look wrong to you before I proceed?"

If the user says "just fix it" or "skip the test," push back gently:
> "I want to verify this against real system data first via Phase 2.5. Can you show me an actual [event/log] for each assumption? It takes 5 minutes and prevents us from fixing the wrong thing."

---

## Why Phase 1 Data Collection Often Prevents Code Tracing Entirely

**Real example:** "Can we distinguish connectionFound vs connectionFixed workflows in the event?"

**Wrong approach (what I did):**
1. Read question: "Can we distinguish workflows?"
2. Jump to code tracing (Phases 2-3) without seeing data
3. Trace code, make inferences
4. Declare "100% confident" in theory based only on code
5. User corrects me with actual data
6. Theory collapses

**Wasted time:** 2+ hours of code tracing

**Right approach:**
1. Read question: "Can we distinguish workflows?"
2. **Phase 1:** Request FHIR server credentials
3. **Query ActivityDefinitions myself** for both strategies
4. **Inspect the actual JSON** → Both have code.coding[0].code = "data-connection"
5. **Answer visible immediately:** "No, the activityType field is identical. But I see identifier.value differs..." 
6. **Optionally continue:** If needed, query actual events to see what flows through
7. **Done in 5 minutes without any code tracing**

**Why this works:** The answer is already in the data. Code tracing is unnecessary until you've exhausted what the real data tells you. By querying myself, I don't depend on user extraction and can explore freely.

### Anti-Pattern to Avoid

❌ "I'll trace code to understand what should happen, then verify against data"

✅ "I'll look at actual data first to see what IS happening, then understand why if needed"

The second approach finds bugs 10x faster because many times the data tells the whole story.

---

## Example: How This Prevents "False Confidence"

**Scenario:** User asks "Can we distinguish connectionFound vs connectionFixed in directActionTaskReady events?"

**Phase 2, Iteration 1:**

```
## Assumptions (Iteration 1):

| Assumption | Source | Status | Evidence So Far |
|---|---|---|---|
| ActivityType field contains different values for each workflow | Code path shows extraction from ActivityDefinition.code.coding | ❓ UNVALIDATED | TaskChangeEventBuilder line 20 extracts from task coding system ACTIVITY_TYPE |
| Both workflows produce different activityType values | FoundConnectionStrategy vs FixedConnectionStrategy use different connection types | ❓ UNVALIDATED | Strategies use DATA_CONNECTION_VALUE vs DATA_CONNECTION_FIXED_VALUE constants |
| This distinguishes them in the directActionTaskReady event | Code traces show field flowing to hp-notification-service | ❓ UNVALIDATED | IterableTaskChangeEvent includes activityType field |

**Next iteration will validate these by:**
1. Checking what actual ActivityDefinition JSON looks like for both workflows
2. Verifying what values are actually in those connection type constants
3. Confirming what ends up in the real event sent to Iterable

**Questions for you before proceeding:**
- Do you have examples of actual ActivityDefinitions I can examine?
- Have you seen the actual events in Kafka or Iterable for both workflows?
```

**You see the assumptions table and say:** "Actually, let me show you the ActivityDefinitions. Both have code='data-connection', not different values."

→ **Result:** We catch the wrong assumption BEFORE declaring confidence, not after.

**Phase 2.5 Validation Report (if we'd proceeded):**

```
## Phase 2.5 Assumption Validation Report

| # | Assumption | Evidence You Provided | Finding | Impact |
|---|---|---|---|---|
| 1 | ActivityType has different values | ActivityDefinition JSON for both | ✗ REJECTED: Both have code="data-connection" | Hypothesis WRONG |
| 2 | Workflows produce different activityType values | Real event data from Iterable | ✗ REJECTED: Both events have activityType="data-connection" | Confidence COLLAPSED |
| 3 | Field distinguishes them | Real Kafka messages | ✗ REJECTED: Same value in both | False lead eliminated |

**Real distinguisher:** activityName or activityDefinitionId (different for each workflow)

**Status:** Return to Phase 2. Previous hypothesis rejected.
```

This structure prevents what happened:
- ❌ OLD: I declared "100% confident" based on code reading
- ✅ NEW: I show assumptions, you see them, you catch the error, we validate against real data first

---

## Case Study: The Workaround That Was the Bug (INE-653 → INE-600)

**A worked example of the boundary-misattribution failure** — distinct from the code-vs-data false-confidence failure above. Here the investigator HAD real data but still shipped a fix that made things worse, because they misjudged *which layer was wrong*.

**Symptom:** DCS orchestrator population failed for a large org (WellSense, 1.72M persons) — `uk_work_unit_person` duplicate-key violations, infinite recovery loops (89 cycles in 20h), 5.6× work-unit inflation. FHIR Person paging failed on page 2+.

**The wrong fix (PR #179, merged, +250/−20):** The investigator concluded *"the FHIR server's `next` link uses the internal UUID as the `id:above` cursor instead of the resource's actual `id`"* — i.e., **declared the server wrong** — and added 71 lines of cursor-rewriting logic (`correctIdAboveCursor`) plus a 179-line test to "correct" the server's cursor to the last entry's logical id. The PR even admitted: *"This is a client-side workaround. The proper fix is in the FHIR server's cursor generation logic… A separate ticket should track that."*

**Why it was wrong:** The server's cursor was *correct and internally consistent* — it sorts by `_uuid` AND cursors by `_uuid`. The rewrite to logical id is what BROKE paging for non-UUID ids: `id:above=<logical-id>` filters on `_sourceId` while the sort is still `_uuid`, so pages overlap and skip. **The "fix" was the root cause.** The investigator never verified the server's contract (what field does it sort by? what field does `id:above` filter on for a non-UUID id?) — they assumed the unfamiliar behavior was a defect.

**The real fix (client PR #186 + orchestrator PR #164, net code DELETION):**
- #186 **deleted** `correctIdAboveCursor` and its test (Search.java +5/−51, test −179): follow the server's `next` link verbatim. PR body: *"that `correctIdAboveCursor` workaround was an earlier, incomplete attempt at this same problem and **is the root cause**."*
- #164 forced `_sort=_uuid` on the orchestrator's population query so its sort matches the cursor field, plus an idempotent `ON CONFLICT DO NOTHING` insert.

**What would have caught it in this skill:**
- **Phase 2 boundary check:** before changing the client, trace *what the server's cursor actually filters on for a non-UUID id* — that reveals the sort/filter field mismatch and points at the orchestrator's missing `_sort`, not the server.
- **Phase 3 disqualifier:** "planning a separate ticket for the proper fix" = a workaround, not root cause. Stop.
- **Fix-quality reflex:** the proposed fix only ADDED a compensation layer. Asking "what if I DELETE the rewrite and trust the contract?" lands directly on the real fix.

**Lesson:** Real data proving the *symptom* (paging fails) is not the same as proving the *mechanism* (which layer violates which contract). Verify the boundary's contract before declaring it broken, and treat a compensating-layer fix as a smell.

---

## Full Example: Multi-Iteration Investigation

**Scenario:** "Can we distinguish connectionFound vs connectionFixed in directActionTaskReady events?"

### **ITERATION 1**

```
## Iteration 1 Summary Report
[This is the first iteration, no previous to report]

## Current Assumptions (Iteration 1):

| Assumption | Source | Will Validate By |
|---|---|---|
| ActivityType field contains different values per workflow | Code extraction in TaskChangeEventBuilder line 20 | Check what ActivityDefinition.code.coding actually contains for each strategy |
| Both workflows assign different connection type values | FoundConnectionStrategy vs FixedConnectionStrategy use different constants | Trace constant values: DATA_CONNECTION_VALUE vs DATA_CONNECTION_FIXED_VALUE |
| This field flows unchanged to hp-notification-service | Code shows field in IterableTaskChangeEvent and EventPublishingService | Check if the field is serialized to Iterable |

**Questions for you before proceeding:**
- Does this match how the system actually works?
```

You review and say: "Let me show you the actual ActivityDefinitions..."

```
[You provide actual ActivityDefinition JSON showing both have code="data-connection"]

**ITERATION 2**

## Iteration 1 Summary Report

### Assumptions from Iteration 1:

| Assumption | Check Performed | Evidence Found | Status | Impact |
|---|---|---|---|---|
| ActivityType field contains different values per workflow | Code inspection + user-provided ActivityDefinition JSON | BOTH ActivityDefinitions have code.coding[0].code = "data-connection" | ✗ DISPROVEN | Major: original hypothesis WRONG |
| Both workflows assign different connection type values | Checked constants + actual JSON | User showed: identifier with system="https://www.icanbwell.com/connectionType" — values ARE different ("DataConnectionFixed" vs "DataConnection") but this is NOT in the activityType coding | ⚠️ INCONCLUSIVE | Found different field but not the one we were checking |
| Field flows unchanged to hp-notification-service | Code still shows it flows | Assumption depends on activityType being different, which is FALSE | ✗ DISPROVEN | Dependent on assumption 1 |

### What This Iteration Revealed:
- ✗ DISPROVEN: activityType is NOT the distinguishing field (both have "data-connection")
- ✓ DISCOVERED: There IS a different field: identifier.system="connectionType" with values "DataConnectionFixed" vs "DataConnection"
- 🎯 Scope shifted: Not looking at code.coding anymore, now looking at identifiers

### Hypothesis Evolution:
- **Iteration 1 hypothesis:** "Use activityType field to distinguish workflows"
- **Current hypothesis (Iteration 2):** "Real distinction is in identifier values or other ActivityDefinition properties, NOT in activityType coding"
- **Rejected paths:** activityType field is a dead end

### Confidence Trajectory:
- Iteration 1: LOW (many untested assumptions)
- Iteration 2: MEDIUM (found that one key assumption was wrong, but found alternative distinguisher)
- Next blocker: Do identifier values actually flow to hp-notification-service? Or do we use activityName instead?

## Current Assumptions (Iteration 2):

| Assumption | Source | Previous Status | Will Validate By |
|---|---|---|---|
| Real distinguisher is identifier.value for connectionType system | User-provided ActivityDefinition JSON | NEW from Iteration 1 findings | Check if identifiers are copied to Task and flow to events |
| Or alternatively, activityName distinguishes them (different for each workflow) | ActivityDefinition shows "Connection Fixed" vs "Complete Your Health Record Connection" | NEW (alternative hypothesis) | Check if activityName is available in directActionTaskReady event |
| Workflow strategy extension ("fixedConnectionStrategy" vs "foundConnectionStrategy") might also distinguish | Extension field in ActivityDefinition | NEW (third alternative) | Check if extensions are extracted and flow through |

**Questions for you before proceeding:**
- Which of these fields do you think actually flows through to the notification event?
- Or should we check all three?
```

[You provide Kafka logs showing what's actually in the directActionTaskReady event]

```
[Similar pattern continues to Iteration 3, where we validate which fields actually made it through]
```

### **Benefits of This Format**

1. **Transparent hypothesis evolution** — You see which assumptions held and which collapsed
2. **Early course corrections** — You can interject when assumptions look wrong BEFORE deep investigation
3. **Running scorecard** — Each iteration shows progress: "We ruled out X, discovered Y, narrowed to Z"
4. **Accountability** — "I said this would distinguish them" vs. "Reality showed this distinguishes them"
5. **Context for Phase 2.5** — By the time we reach evidence collection, we have a clear record of what still needs validating
