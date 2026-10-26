// The calculate tool (calculator experiment): exact arithmetic for totals, differences,
// discounts and prices, which the local models get wrong in their heads (17*23+154 answered
// 549 and 405; a four-number sum off by 1,000). A small parser, not eval: numbers, + - * /,
// parentheses and unary minus; thousands separators in numbers are accepted.
export const CALC_TOOL_DEF = {
  name: "calculate",
  description:
    "Exact arithmetic. Use it for every sum, difference, product, percentage or price you report instead of working it out " +
    "in your head. expression: numbers with + - * / and parentheses, for example (182.40 + 36.80 + 193.10) or 40 * 0.85 * 1.08. " +
    "Thousands separators such as 12,400 are fine.",
  input_schema: {
    type: "object",
    properties: { expression: { type: "string", description: "The arithmetic expression" } },
    required: ["expression"],
  },
};

const EXPRESSION_MAX_CHARS = 500;

export function calculate(expression) {
  const src = String(expression ?? "").replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/[×x]/g, "*").replace(/÷/g, "/");
  if (src.length > EXPRESSION_MAX_CHARS) throw new Error(`The expression is longer than ${EXPRESSION_MAX_CHARS} characters.`);
  const tokens = src.match(/\d+(?:\.\d+)?|\.\d+|[-+*/()]|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const fail = (what) => { throw new Error(`Cannot calculate "${expression}": ${what}. Use numbers, + - * / and parentheses.`); };
  const number = () => {
    const t = tokens[i++];
    if (t === "(") { const v = sum(); if (tokens[i++] !== ")") fail("a parenthesis is not closed"); return v; }
    if (t === "-") return -number();
    if (t === "+") return number();
    if (t !== undefined && /^(\d|\.\d)/.test(t)) return Number(t);
    return fail(t === undefined ? "it ends too early" : `unexpected "${t}"`);
  };
  const product = () => {
    let v = number();
    while (peek() === "*" || peek() === "/") {
      const op = tokens[i++], r = number();
      if (op === "/" && r === 0) fail("division by zero");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = () => {
    let v = product();
    while (peek() === "+" || peek() === "-") v = tokens[i++] === "+" ? v + product() : v - product();
    return v;
  };
  const value = sum();
  if (i < tokens.length) fail(`unexpected "${tokens[i]}"`);
  // Binary fractions (0.1 + 0.2): round to 10 decimals, then drop trailing zeros.
  return String(Number(value.toFixed(10)));
}
