// E2E fixtures run against the current date unless the test explicitly owns its clock.
const fixedDate = /(?:\b\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?|\d{4}年)/u;

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      fixed: "E2Eの日付は helpers/scenario の相対日付を使ってください。時計固定・境界値・過去履歴の検証に必要な固定値だけ、理由付きの eslint-disable-next-line で許可します。",
    },
  },
  create(context) {
    function check(node, value) {
      if (typeof value === "string" && fixedDate.test(value)) {
        context.report({ node, messageId: "fixed" });
      }
    }
    return {
      Literal(node) { check(node, node.regex?.pattern ?? node.value); },
      TemplateElement(node) { check(node, node.value.cooked ?? node.value.raw); },
      NewExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "Date") return;
        const first = node.arguments[0];
        if (first?.type === "Literal" && typeof first.value === "number") {
          context.report({ node, messageId: "fixed" });
        }
      },
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression"
          || node.callee.object.type !== "Identifier" || node.callee.object.name !== "Date"
          || node.callee.property.type !== "Identifier" || node.callee.property.name !== "UTC") return;
        if (node.arguments[0]?.type === "Literal") context.report({ node, messageId: "fixed" });
      },
    };
  },
};
