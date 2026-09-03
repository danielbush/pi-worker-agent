# Concepts

Concepts that underpin the design of this system.

## HARDNESS_LEVELS

- HARD_CODED
  - things that are enshrined in code
  - most of the task/job system is enshrined in code
- STRUCTURED
  - things are stored ina  strutured way but they can be edited;
  - most data in the database fits this category
  - the requirement for subdirs $DATA_ROOT/projects/XXX/ is part of a structured approach to storing
  - TODO: job types should be put into job_types table for flexibility rather than hard coded
- SOFT_CODED
  - things that the manager agent reads and applies; no code
  - the project management layer that sits above the task/job execution layer is mostly SOFT_CODED via policy documents
  - this gives 
  - most of $DATA_ROOT/projects

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
