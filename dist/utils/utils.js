"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateGuestSchema = exports.createGuestSchema = exports.updateEventSchema = exports.createEventSchema = exports.option = exports.UpdatePasswordSchema = exports.updateAdminProfileSchema = exports.LoginAdminSchema = exports.RegisterAdminSchema = void 0;
const joi_1 = __importDefault(require("joi"));
exports.RegisterAdminSchema = joi_1.default.object({
    username: joi_1.default.string().required(),
    name: joi_1.default.string().required(),
    email: joi_1.default.string().email().required(),
    password: joi_1.default.string()
        .min(6)
        .regex(/^[a-zA-Z0-9~!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/`]{6,}$/)
        .required()
        .messages({
        "string.pattern.base": "Password contains invalid characters.",
    }),
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
exports.createEventSchema = joi_1.default.object({
    name: joi_1.default.string().required(),
    date: joi_1.default.string().required(),
    location: joi_1.default.string().required(),
    description: joi_1.default.string().required(),
    iv: joi_1.default.string().base64().optional()
});
exports.updateEventSchema = joi_1.default.object({
    name: joi_1.default.string().optional(),
    date: joi_1.default.string().optional(),
    location: joi_1.default.string().optional(),
    description: joi_1.default.string().optional(),
    iv: joi_1.default.string().base64().optional(),
});
exports.createGuestSchema = joi_1.default.object({
    fullname: joi_1.default.string().required(),
    TableNo: joi_1.default.string().optional().allow("", null),
    email: joi_1.default.string().email().optional().allow("", null),
    phone: joi_1.default.string().optional().allow("", null),
    message: joi_1.default.string().required(),
    others: joi_1.default.string().optional().allow("", null),
    eventId: joi_1.default.string().required(),
    qrCodeBgColor: joi_1.default.string().required(),
    qrCodeCenterColor: joi_1.default.string().required(),
    qrCodeEdgeColor: joi_1.default.string().required(),
});
exports.updateGuestSchema = joi_1.default.object({
    id: joi_1.default.string().required(),
    fullname: joi_1.default.string().allow('').optional(),
    TableNo: joi_1.default.string().allow('').optional(),
    email: joi_1.default.string().email().allow('').optional(),
    phone: joi_1.default.string().allow('').optional(),
    message: joi_1.default.string().allow('').optional(),
    others: joi_1.default.string().allow('').optional(),
    qrCodeBgColor: joi_1.default.string().allow('').optional(),
    qrCodeCenterColor: joi_1.default.string().allow('').optional(),
    qrCodeEdgeColor: joi_1.default.string().allow('').optional(),
});
