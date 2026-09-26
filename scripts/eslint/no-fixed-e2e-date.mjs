// E2E business dates come from the shared scenario helper, never the host clock.
const fixedDate = /(?:\b\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?|\d{4}年)/u;

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      fixed: "E2Eの日付は helpers/scenario の業務基準日から作ってください。境界値や履歴の明示値だけ理由付きで許可します。",
      realtime: "E2Eのspec/seedでは実時計を読まず、helpers/scenario の業務基準日を使ってください。",
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
        if (node.arguments.length === 0) context.report({ node, messageId: "realtime" });
        const first = node.arguments[0];
        if (first?.type === "Literal" && typeof first.value === "number") {
          context.report({ node, messageId: "fixed" });
        }
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "Date" && node.arguments.length === 0) {
          context.report({ node, messageId: "realtime" });
        }
        if (node.callee.type === "MemberExpression"
          && node.callee.object.type === "Identifier" && node.callee.object.name === "Date"
          && node.callee.property.type === "Identifier" && node.callee.property.name === "now") {
          context.report({ node, messageId: "realtime" });
        }
        if (node.callee.type !== "MemberExpression"
          || node.callee.object.type !== "Identifier" || node.callee.object.name !== "Date"
          || node.callee.property.type !== "Identifier" || node.callee.property.name !== "UTC") return;
        if (node.arguments[0]?.type === "Literal") context.report({ node, messageId: "fixed" });
      },
    };
  },
};
