# Lethal Trifecta Gate

Flag any code path that combines all three:
1. Deserialization of untrusted input (JSON.parse, eval, vm.runInNewContext)
2. Privilege escalation (sudo, setuid, os.exec with elevated context)
3. Dynamic command construction from that input

## Severity
CRITICAL when all three are present in a traceable data flow.
WARNING when two are present and the third is plausible.

## Examples of CRITICAL
- JSON.parse(userInput) fed into exec()
- YAML.load(req.body) with constructor gadget in scope