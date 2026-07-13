import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./code-review-conventions.cases.js";

describeSkill("code-review-conventions", () => runSkillCases("code-review-conventions", cases));
