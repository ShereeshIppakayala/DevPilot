import { loginUser, registerUser, toPublicUser } from '../services/auth.service.js'
import { validateLogin, validateRegistration } from '../validators/auth.validators.js'

export async function register(req, res) {
  const input = validateRegistration(req.body)
  const user = await registerUser(input)
  res.status(201).json({ user })
}

export async function login(req, res) {
  const input = validateLogin(req.body)
  const result = await loginUser(input)
  res.status(200).json(result)
}

export async function getCurrentUser(req, res) {
  res.status(200).json({ user: toPublicUser(req.user) })
}