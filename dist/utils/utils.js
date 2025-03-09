"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateGuestSchema = exports.createGuestSchema = exports.updateEventSchema = exports.creatEventSchema = exports.option = exports.UpdatePasswordSchema = exports.updateAdminProfileSchema = exports.LoginAdminSchema = exports.RegisterAdminSchema = void 0;
const joi_1 = __importDefault(require("joi"));
exports.RegisterAdminSchema = joi_1.default.object({
    username: joi_1.default.string().required(),
    name: joi_1.default.string().required(),
    email: joi_1.default.string().email().required(),
    password: joi_1.default.string()
        .min(6)
        .regex(/^[a-zA-Z0-9]{3,30}$/)
        .required(),
    confirm_password: joi_1.default.string()
        .valid(joi_1.default.ref("password"))
        .required()
        .label("confirm password")
        .messages({ "any.only": "{{#label}} does not match" }),
});
exports.LoginAdminSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
    password: joi_1.default.string()
        .min(6)
        .regex(/^[a-zA-Z0-9]{3,30}$/)
        .required(),
});
exports.updateAdminProfileSchema = joi_1.default.object({
    username: joi_1.default.string().optional(),
    name: joi_1.default.string().optional(),
});
exports.UpdatePasswordSchema = joi_1.default.object({
    old_password: joi_1.default.string()
        .min(6)
        .regex(/^[a-zA-Z0-9]{3,30}$/)
        .required(),
    new_password: joi_1.default.string()
        .min(6)
        .regex(/^[a-zA-Z0-9]{3,30}$/)
        .required(),
    confirm_password: joi_1.default.string()
        .valid(joi_1.default.ref("new_password"))
        .required()
        .label("confirm password")
        .messages({ "any.only": "{{#label}} does not match" }),
});
exports.option = {
    abortearly: false,
    errors: {
        wrap: {
            label: "",
        },
    },
};
exports.creatEventSchema = joi_1.default.object({
    name: joi_1.default.string().required(),
    date: joi_1.default.string().required(),
    location: joi_1.default.string().required(),
    isActive: joi_1.default.boolean().default(true),
});
exports.updateEventSchema = joi_1.default.object({
    name: joi_1.default.string().required(),
    date: joi_1.default.string().required(),
    location: joi_1.default.string().required(),
});
// Define allowed QR code colors
const qrCodeColors = ["black", "blue", "red", "yellow", "green", "gold"];
exports.createGuestSchema = joi_1.default.object({
    firstName: joi_1.default.string().required(),
    lastName: joi_1.default.string().required(),
    email: joi_1.default.string().email().required(),
    phone: joi_1.default.string().required(),
    eventId: joi_1.default.string().required(),
    qrCodeColor: joi_1.default.string()
        .valid(...qrCodeColors)
        .required()
        .messages({
        "any.only": `QR Code color must be one of: ${qrCodeColors.join(", ")}`,
        "any.required": "QR Code color is required",
    }),
});
exports.updateGuestSchema = joi_1.default.object({
    firstName: joi_1.default.string().required(),
    lastName: joi_1.default.string().required(),
    email: joi_1.default.string().email().required(),
    phone: joi_1.default.string().required(),
    eventId: joi_1.default.string().required(),
});
