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

export const updateAdminProfileSchema = Joi.object({
  username: Joi.string().required(),
  name: Joi.string().required(),
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
  date: Joi.date().required(),
  location: Joi.string().required(),
  isActive: Joi.boolean().default(true),
  guests: Joi.array().items(Joi.string()),
});

export const updateEventSchema = Joi.object({
  name: Joi.string().required(),
  date: Joi.date().required(),
  location: Joi.string().required(),
});

export const createGuestSchema = Joi.object({
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string().required(),
  qrCode: Joi.string().required(),
  eventId: Joi.string().required(),
});

export const updateGuestSchema = Joi.object({
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string().required(),
  qrCode: Joi.string().required(),
  eventId: Joi.string().required(),
});
