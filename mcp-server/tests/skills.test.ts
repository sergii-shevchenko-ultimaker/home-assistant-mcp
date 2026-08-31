import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRoot = path.resolve(__dirname, "../../skills");

interface ParsedSkill {
  name?: string;
  description?: string;
  rawFrontmatter: string;
  body: string;
  headings: string[];
}

function parseSkillFile(filePath: string): ParsedSkill {
  const content = fs.readFileSync(filePath, "utf-8");
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error(`File ${filePath} is missing valid YAML frontmatter`);
  }

  const rawFrontmatter = fmMatch[1];
  const body = fmMatch[2];

  let name: string | undefined;
  let description: string | undefined;

  const lines = rawFrontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("name:")) {
      name = line.replace(/^name:\s*/, "").trim().replace(/^['"]|['"]$/g, "");
    } else if (line.startsWith("description:")) {
      let desc = line.replace(/^description:\s*/, "").trim();
      if (desc.startsWith(">") || desc.startsWith("|")) {
        const descLines: string[] = [];
        while (i + 1 < lines.length && (lines[i + 1].startsWith("  ") || lines[i + 1].trim() === "")) {
          i++;
          descLines.push(lines[i].trim());
        }
        desc = descLines.join(" ");
      } else {
        desc = desc.replace(/^['"]|['"]$/g, "");
      }
      description = desc;
    }
  }

  const headings = Array.from(body.matchAll(/^#{1,4}\s+(.+)$/gm)).map((m) => m[1].trim());

  return {
    name,
    description,
    rawFrontmatter,
    body,
    headings,
  };
}

describe("AI Skill Pack (`skills/`) Specification & Validation", () => {
  const expectedSkills = [
    {
      dir: "ha-dashboard-designer",
      name: "ha-dashboard-designer",
      requiredTools: [
        "ha_system_list_entities",
        "ha_dashboard_get_config",
        "ha_dashboard_save_config",
        "ha_dashboard_render_screenshot",
      ],
      requiredStepKeywords: [
        "Query available entities",
        "Inspect existing dashboard",
        "layout",
        "Save Lovelace",
        "screenshot",
        "Visual Inspection Loop",
      ],
    },
    {
      dir: "ha-automation-builder",
      name: "ha-automation-builder",
      requiredTools: [
        "ha_automation_list",
        "ha_automation_read",
        "ha_automation_write",
        "ha_automation_trigger",
        "ha_system_get_logs",
      ],
      requiredStepKeywords: [
        "Discover entity",
        "Read existing automations",
        "Construct safe YAML",
        "Write automation",
        "Test trigger",
      ],
    },
    {
      dir: "ha-troubleshooter",
      name: "ha-troubleshooter",
      requiredTools: [
        "ha_system_health",
        "ha_system_get_logs",
        "ha_system_restore_backup",
        "ha_system_create_backup",
      ],
      requiredStepKeywords: [
        "Healthcheck",
        "logs",
        "rollback",
        "Verify",
      ],
    },
  ];

  it("should have the skills directory present", () => {
    expect(fs.existsSync(skillsRoot)).toBe(true);
  });

  for (const skill of expectedSkills) {
    describe(`Skill: ${skill.name}`, () => {
      const skillPath = path.join(skillsRoot, skill.dir, "SKILL.md");

      it("should exist as SKILL.md in the respective directory", () => {
        expect(fs.existsSync(skillPath)).toBe(true);
      });

      it("should parse valid YAML frontmatter with correct name and non-empty description", () => {
        const parsed = parseSkillFile(skillPath);
        expect(parsed.name).toBe(skill.name);
        expect(parsed.description).toBeDefined();
        expect(parsed.description!.length).toBeGreaterThan(10);
      });

      it("should contain standard required markdown sections (Overview, Workflow, Tools, Safety)", () => {
        const parsed = parseSkillFile(skillPath);
        const headingTexts = parsed.headings.map((h) => h.toLowerCase());

        const hasOverview = headingTexts.some((h) => h.includes("overview"));
        const hasWorkflow = headingTexts.some((h) => h.includes("workflow") || h.includes("steps") || h.includes("standard operating procedure"));
        const hasTools = headingTexts.some((h) => h.includes("tool") || h.includes("mcp"));
        const hasSafety = headingTexts.some((h) => h.includes("safety") || h.includes("rules") || h.includes("best practice"));

        expect(hasOverview, `Skill ${skill.name} missing Overview section`).toBe(true);
        expect(hasWorkflow, `Skill ${skill.name} missing Workflow section`).toBe(true);
        expect(hasTools, `Skill ${skill.name} missing Tools section`).toBe(true);
        expect(hasSafety, `Skill ${skill.name} missing Safety Rules section`).toBe(true);
      });

      it("should reference all required MCP tools in its body or tool section", () => {
        const parsed = parseSkillFile(skillPath);
        for (const toolName of skill.requiredTools) {
          expect(
            parsed.body.includes(toolName),
            `Skill ${skill.name} must reference tool '${toolName}'`
          ).toBe(true);
        }
      });

      it("should cover all required workflow step keywords", () => {
        const parsed = parseSkillFile(skillPath);
        const lowerBody = parsed.body.toLowerCase();
        for (const kw of skill.requiredStepKeywords) {
          expect(
            lowerBody.includes(kw.toLowerCase()),
            `Skill ${skill.name} should include step content mentioning '${kw}'`
          ).toBe(true);
        }
      });
    });
  }
});
