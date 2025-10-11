import Joi from "joi";

export const RegisterAdminSchema = Joi.object({
  username: Joi.string().required(),
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  password: Joi.string()
    .min(6)
    .regex(/^[a-zA-Z0-9~!@#$%^&*()_\-+={[}\]|\\:;"'<>,.?/`]{6,}$/)
    .required()
    .messages({
      "string.pattern.base": "Password contains invalid characters.",
    }),
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

export const createEventSchema = Joi.object({
  name: Joi.string().required(),
  date: Joi.string().required(),
  location: Joi.string().required(),
  description: Joi.string().required(),
  iv: Joi.string().base64().optional() 
});

export const updateEventSchema = Joi.object({
  name: Joi.string().optional(),
  date: Joi.string().optional(),
  location: Joi.string().optional(),
  description: Joi.string().optional(),
  iv: Joi.string().base64().optional(), 
});

export const createGuestSchema = Joi.object({
  fullname: Joi.string().required(),
  TableNo: Joi.string().optional().allow("", null),
  email: Joi.string().email().optional().allow("", null),
  phone: Joi.string().optional().allow("", null),
  message: Joi.string().required(),
  others: Joi.string().optional().allow("", null),
  eventId: Joi.string().required(),
  qrCodeBgColor: Joi.string().required(),
  qrCodeCenterColor: Joi.string().required(),
  qrCodeEdgeColor: Joi.string().required(),
});

export const updateGuestSchema = Joi.object({
  id: Joi.string().required(),
  fullname: Joi.string().allow('').optional(),
  TableNo: Joi.string().allow('').optional(),
  email: Joi.string().email().allow('').optional(),
  phone: Joi.string().allow('').optional(),
  message: Joi.string().allow('').optional(),
  others: Joi.string().allow('').optional(), // Now allows empty strings
  qrCodeBgColor: Joi.string().allow('').optional(),
  qrCodeCenterColor: Joi.string().allow('').optional(),
  qrCodeEdgeColor: Joi.string().allow('').optional(),
});
