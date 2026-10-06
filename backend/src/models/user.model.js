import mongoose from 'mongoose'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const bcryptHashPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

export const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    maxlength: [254, 'Email cannot exceed 254 characters'],
    match: [emailPattern, 'Email must be a valid email address'],
  },
  passwordHash: {
    type: String,
    select: false,
    maxlength: [255, 'Password hash cannot exceed 255 characters'],
    validate: {
      validator: (value) => value == null || bcryptHashPattern.test(value),
      message: 'Password must be stored as a bcrypt hash',
    },
  },
  displayName: {
    type: String,
    trim: true,
    maxlength: [80, 'Display name cannot exceed 80 characters'],
  },
  status: {
    type: String,
    enum: ['active', 'suspended'],
    default: 'active',
    required: true,
  },
  emailVerifiedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
  strict: 'throw',
  toJSON: {
    transform(_document, result) {
      delete result.passwordHash
      delete result.__v
      return result
    },
  },
})

userSchema.index({ email: 1 }, { unique: true, name: 'uniq_users_email' })

export const User = mongoose.models.User ?? mongoose.model('User', userSchema)