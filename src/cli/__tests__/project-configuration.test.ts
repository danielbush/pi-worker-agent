import { describe, expect, test } from "bun:test";
import { validateProjectMappings } from "../project-configuration.ts";

describe("project configuration", () => {
  test("returns configured projects", () => {
    // arrange
    const directories = ["alpha", "beta"];

    // act
    const projects = validateProjectMappings(directories, ["alpha", "beta"]);

    // assert
    expect(projects).toEqual(directories);
  });

  test("fails when no project directories exist", () => {
    // arrange
    const validate = () => validateProjectMappings([], []);

    // act / assert
    expect(validate).toThrow("no project directories found under DATA_ROOT/projects");
  });

  test("fails when a directory is not registered", () => {
    // arrange
    const validate = () => validateProjectMappings(["alpha", "beta"], ["alpha"]);

    // act / assert
    expect(validate).toThrow("project directories are not registered: beta");
  });

  test("fails when a registered project has no directory", () => {
    // arrange
    const validate = () => validateProjectMappings(["alpha"], ["alpha", "beta"]);

    // act / assert
    expect(validate).toThrow("registered projects have no directory: beta");
  });
});
