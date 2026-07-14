import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./security.cases.js";

describeSkill("security", () => runSkillCases("security", cases));
