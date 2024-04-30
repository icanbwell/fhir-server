const antlr4 = require('antlr4');

// test file
// const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
// const expectedPatientResources = require('./fixtures/expected/expected_patient.json');

const { commonBeforeEach, commonAfterEach } = require('../../common');
const { describe, beforeEach, afterEach, test } = require('@jest/globals');
const FHIRPathLexer = require('./parser/generated/FHIRPathLexer');
const FHIRPathParser = require('./parser/generated/FHIRPathParser');
const FHIRPathVisitor = require('./parser/generated/FHIRPathVisitor');

async function foo () {
// Define your custom visitor
    class MyVisitor extends FHIRPathVisitor {
        // Implement visit methods for each rule in your grammar
        // visitExpression (ctx) {
        //     // Handle expression rule
        //     return this.visitChildren(ctx);
        // }
        //
        // visitChildren (ctx) {
        //     // Handle children of the current node
        //     return super.visitChildren(ctx);
        // }
        //
        // Implement visit methods for other rules as needed
// Visit a parse tree produced by FHIRPathParser#entireExpression.
        visitEntireExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#indexerExpression.
        visitIndexerExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#polarityExpression.
        visitPolarityExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#additiveExpression.
        visitAdditiveExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#multiplicativeExpression.
        visitMultiplicativeExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#unionExpression.
        visitUnionExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#orExpression.
        visitOrExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#andExpression.
        visitAndExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#membershipExpression.
        visitMembershipExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#inequalityExpression.
        visitInequalityExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#invocationExpression.
        visitInvocationExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#equalityExpression.
        visitEqualityExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#impliesExpression.
        visitImpliesExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#termExpression.
        visitTermExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#typeExpression.
        visitTypeExpression (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#invocationTerm.
        visitInvocationTerm (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#literalTerm.
        visitLiteralTerm (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#externalConstantTerm.
        visitExternalConstantTerm (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#parenthesizedTerm.
        visitParenthesizedTerm (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#nullLiteral.
        visitNullLiteral (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#booleanLiteral.
        visitBooleanLiteral (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#stringLiteral.
        visitStringLiteral (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#numberLiteral.
        visitNumberLiteral (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#dateTimeLiteral.
        visitDateTimeLiteral (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#timeLiteral.
        visitTimeLiteral (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#quantityLiteral.
        visitQuantityLiteral (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#externalConstant.
        visitExternalConstant (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#memberInvocation.
        visitMemberInvocation (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#functionInvocation.
        visitFunctionInvocation (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#thisInvocation.
        visitThisInvocation (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#indexInvocation.
        visitIndexInvocation (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#totalInvocation.
        visitTotalInvocation (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#functn.
        visitFunctn (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#paramList.
        visitParamList (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#quantity.
        visitQuantity (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#unit.
        visitUnit (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#dateTimePrecision.
        visitDateTimePrecision (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#pluralDateTimePrecision.
        visitPluralDateTimePrecision (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#typeSpecifier.
        visitTypeSpecifier (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#qualifiedIdentifier.
        visitQualifiedIdentifier (ctx) {
            return this.visitChildren(ctx);
        }

// Visit a parse tree produced by FHIRPathParser#identifier.
        visitIdentifier (ctx) {
            return this.visitChildren(ctx);
        }
    }

// Create a lexer and parser
    const input = 'Patient.extension.where(url = \'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race\').extension.value.code';
    const chars = new antlr4.InputStream(input);
    const lexer = new FHIRPathLexer(chars);
    const tokens = new antlr4.CommonTokenStream(lexer);
    const parser = new FHIRPathParser(tokens);

// Parse the input
    const tree = parser.expression();

    // Print the parse tree in Lisp-like format
    console.log(tree.toStringTree(parser.ruleNames));
// Create a visitor and visit the parse tree
    const visitor = new MyVisitor();
    const result = visitor.visit(tree);
    console.log(result);
}

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient fhirPath Tests', () => {
        test('fhirPath works', async () => {
            await foo();
        });
    });
});
