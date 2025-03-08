import Joi from "joi";

export const RegisterAdminSchema = Joi.object({
  username: Joi.string().required(),
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  password: Joi.string()
    .min(6)
    .regex(/^[a-zA-Z0-9]{3,30}$/)
    .required(),
  confirm_password: Joi.string()
    .valid(Joi.ref("password"))
    .required()
    .label("confirm password")
    .messages({ "any.only": "{{#label}} does not match" }),
});

export const LoginAdminSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string()
    .min(6)
    .regex(/^[a-zA-Z0-9]{3,30}$/)
    .required(),
});

export const updateAdminProfileSchema = Joi.object({
  username: Joi.string().optional(),
  name: Joi.string().optional(),
});

export const UpdatePasswordSchema = Joi.object({
  old_password: Joi.string()
    .min(6)
    .regex(/^[a-zA-Z0-9]{3,30}$/)
    .required(),
  new_password: Joi.string()
    .min(6)
    .regex(/^[a-zA-Z0-9]{3,30}$/)
    .required(),
  confirm_password: Joi.string()
    .valid(Joi.ref("new_password"))
    .required()
    .label("confirm password")
    .messages({ "any.only": "{{#label}} does not match" }),
});

export const option = {
  abortearly: false,
  errors: {
    wrap: {
      label: "",
    },
  },
};

export const creatEventSchema = Joi.object({
  name: Joi.string().required(),
  date: Joi.string().required(),
  location: Joi.string().required(),
  isActive: Joi.boolean().default(true),
});

export const updateEventSchema = Joi.object({
  name: Joi.string().required(),
  date: Joi.string().required(),
  location: Joi.string().required(),
});

export const createGuestSchema = Joi.object({
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string().required(),
  eventId: Joi.string().required(),
  qrCodeColor: Joi.string().valid("black", "blue").default("black"),
  status: Joi.string().valid("pending", "checked-in").default("pending"),
  checkedIn: Joi.boolean().default(false),
  imported: Joi.boolean().default(false),
});

export const updateGuestSchema = Joi.object({
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string().required(),
  eventId: Joi.string().required(),
});

// Define allowed QR code colors
const qrCodeColors = ["black", "blue", "red", "yellow", "green", "gold"];

// Joi schema for validating QR code color input
export const qrCodeValidationSchema = Joi.object({
  qrCodeColor: Joi.string()
    .valid(...qrCodeColors)
    .optional()
    .messages({
      "any.only": `QR Code color must be one of: ${qrCodeColors.join(", ")}`,
      "any.required": "QR Code color is required",
    }),
});
