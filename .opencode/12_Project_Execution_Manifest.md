# 11_Project_Execution_Manifest.md

Version: 1.0

Status: Approved

---

# Purpose

This document defines how an implementation agent (OpenCode or any AI coding agent) must execute the CallPilot AI project.

All previous markdown documents define **what** the system is.

This document defines **how** the system must be implemented.

This is the final document that should be read before implementation begins.

---

# Mandatory Reading

Before writing a single line of code, read **every markdown** inside the `.opencode` folder **in numerical order**.

Every document is mandatory.

If a document is split into multiple parts, **all parts must be read completely before proceeding to the next document.**

Example:

```
04_Backend_Architecture_Part1.md
04_Backend_Architecture_Part2.md
04_Backend_Architecture_Part3.md
04_Backend_Architecture_Part4.md
04_Backend_Architecture_Part5.md
```

All five parts together represent **04_Backend_Architecture.md** and must be treated as a single document.

Likewise, if any other numbered document is split into multiple parts, all parts belong to the same document and must be read before continuing.

---

# Reading Order

Read the documentation in the following order.

```
01_*

↓

02_*

↓

03_*

↓

04_* (ALL PARTS)

↓

05_* (ALL PARTS)

↓

06_*

↓

07_*

↓

08_*

↓

09_*

↓

10_*

↓

11_*
```

Never skip a document.

Never skip a part.

Never change the order.

---

# Source of Truth

The `.opencode` folder is the complete project specification.

Every implementation decision must be traceable back to one or more architecture documents.

If documentation appears to conflict:

1. Architecture Decisions (ADR) take precedence.
2. System Architecture defines overall structure.
3. API Contracts define communication.
4. Data Architecture defines persistence.
5. Implementation Roadmap defines execution order.

Do not invent new architecture unless absolutely required.

---

# Implementation Strategy

The implementation milestones are defined **only** by:

**09_Implementation_Roadmap.md**

Do not invent new milestones.

Do not merge milestones.

Do not reorder milestones.

Execute every roadmap milestone exactly as documented.

---

# Execution Rules

Only one milestone may be active at any time.

Before beginning a milestone:

* Read the relevant documentation again if necessary.
* Understand the affected architecture.
* Identify affected projects.
* Identify affected contracts.
* Identify affected database changes.

Only then begin implementation.

---

# During Implementation

Maintain production-quality standards.

Always:

* Keep the solution compiling.
* Keep Docker working.
* Follow the documented folder structure.
* Follow Vertical Slice Architecture.
* Follow CQRS.
* Follow Dependency Injection.
* Follow BYOK.
* Follow Provider Abstraction.
* Follow Event-Driven Architecture.
* Preserve architectural boundaries.

Do not implement placeholder business logic.

Do not leave incomplete features.

---

# Milestone Completion Checklist

A milestone is complete only if all of the following are true:

* Solution builds successfully.
* No compilation errors.
* Existing tests pass.
* New tests have been added where appropriate.
* Docker configuration still works.
* Logging has been implemented.
* Error handling has been implemented.
* Documentation has been updated if required.
* No placeholder code exists.
* No TODOs remain for core functionality.

If any of these fail, the milestone is not complete.

---

# Milestone Output

After completing a milestone, output a report containing:

## Summary

What was implemented.

## Files Created

List every new file.

## Files Modified

List every modified file.

## Database

Schema or migration changes.

## APIs

Endpoints added or changed.

## Events

Events added or modified.

## Tests

Tests added or updated.

## Docker

Infrastructure changes.

## Known Issues

Any blockers or limitations.

## Next Milestone

State the next milestone from **09_Implementation_Roadmap.md**.

After the report, stop and wait for user approval.

Do not continue automatically.

---

# Continuous Validation

Throughout implementation, continuously verify that the code complies with:

* Project Vision
* System Architecture
* AI Architecture
* Backend Architecture (all parts)
* Architecture Decisions
* Event Catalog
* API Contracts
* Data Architecture
* Implementation Roadmap
* Reference Implementation
* Project Execution Manifest

If an implementation conflicts with these documents, stop and explain the conflict before making changes.

---

# Final Acceptance Criteria

The project is complete only when:

* Every milestone from **09_Implementation_Roadmap.md** has been completed.
* Every documented feature has been implemented.
* The solution builds successfully.
* Tests pass.
* Docker Compose successfully starts every required service.
* Documentation reflects the implementation.
* No placeholder code remains.
* The repository is suitable for public open-source release.

---

# Final Instruction

You are implementing a production-quality, open-source software platform.

Read every document.

Read every document part.

Implement **one roadmap milestone at a time**.

Complete it fully.

Validate it.

Report the results.

Stop.

Wait for approval.

Never skip ahead.

---

**End of Document — 11_Project_Execution_Manifest.md**
