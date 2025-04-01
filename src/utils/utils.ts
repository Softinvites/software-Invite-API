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
  description: Joi.string().required(),
});

export const updateEventSchema = Joi.object({
  name: Joi.string().optional(),
  date: Joi.string().optional(),
  location: Joi.string().optional(),
  description: Joi.string().optional(),
});

export const createGuestSchema = Joi.object({
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string().required(),
  eventId: Joi.string().required(),
  qrCodeBgColor: Joi.string().required(),
  qrCodeCenterColor: Joi.string().required(),
  qrCodeEdgeColor: Joi.string().required(),
});

export const updateGuestSchema = Joi.object({
  firstName: Joi.string().optional(),
  lastName: Joi.string().optional(),
  email: Joi.string().email().optional(),
  phone: Joi.string().optional(),
  eventId: Joi.string().required(),
  qrCodeBgColor: Joi.string().optional(),
  qrCodeCenterColor: Joi.string().optional(),
  qrCodeEdgeColor: Joi.string().optional(),
});
