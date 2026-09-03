# Concepts

Concepts that underpin the design of this system.

## HARDNESS_LEVELS

- HARD_CODED
  - things that are enshrined in code
  - most of the task/job system is enshrined in code; this is the EXECUTIVE_LAYER of the system
- STRUCTURED
  - things are stored in a strutured way but they can be edited
  - most data in the database fits this category
  - this gives a degree of freedom on top of the HARD_CODED part of the system
  - the requirement for subdirs $DATA_ROOT/projects/XXX/ is part of a structured approach to storing
  - TODO: job types should be put into job_types table for flexibility rather than hard coded
- UNSTRUCTURED / POLICY
  - things that the manager agent reads and applies; no code
  - the project management layer that sits above the task/job execution layer is mostly POLICY / UNSTRUCTURED via policy documents
  - most of $DATA_ROOT/projects is like this; it's free-wheeling and wordy; it's where a human interfaces with an agent
  - `worker_verify_project_structure` reinforces the STRUCTURED boundary around this area (immediate project subdirectories, `sequence.md`, and registered identity) without interpreting the policy-owned contents
  - `worker_manage_project_file` crosses that boundary deliberately: `ProjectFileManager` owns registered-project authorization while generic `ConfinedTextFiles` owns containment and atomic/stale-write safety; policy still determines what the files mean and how they should change
  - if the user mentions "policy" it's this level

HARD_CODED is completely controlled by developers of this project.
STRUCTURED is controlled freedom; eg being able to set your own job_types, but you do it in a structured way
UNSTRUCTURED / POLICY is mostly the consumer and how they want to manage their projects

## DEVELOPMENT_MODE vs MANAGER_MODE

- /development-mode
  - lets the user switch the manager into a less locked down mode (could be dangerous)
- /manager-mode (default)
  - is locked down mode for the manager agent

## COMMAND_TYPES

 - Slash command │ User in interactive Pi             │ /task-status bb5b
 - Manager tool  │ Manager model through a tool call  │ worker_complete_task
 - CLI command   │ Human or process with shell access │ bun run project-status -- pi-worker-agent

A locked-down manager has no shell access, so it cannot run the CLI.

Focus on creating manager tools.  Maybe expose some as slash commands for the user if they really want to run them.  Add cli mappings when required.
