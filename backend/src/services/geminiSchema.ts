import { z } from "zod";
// The schemas used by Gemini in this project use these Zod 3 primitives.
// Unknown shapes fail explicitly instead of sending a misleading provider schema.
export function geminiSchema(schema: z.ZodTypeAny): Record<string, any> {
  if (schema instanceof z.ZodEffects) return geminiSchema(schema.innerType());
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) return geminiSchema(schema._def.innerType);
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: schema.isInt ? "integer" : "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodArray) return { type: "array", items: geminiSchema(schema.element), ...(schema._def.minLength ? { minItems: schema._def.minLength.value } : {}), ...(schema._def.maxLength ? { maxItems: schema._def.maxLength.value } : {}) };
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    return { type: "object", properties: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, geminiSchema(value)])), required: Object.keys(shape).filter(key => !(shape[key] instanceof z.ZodOptional)), additionalProperties: false };
  }
  throw new Error("Unsupported AI response schema");
}
