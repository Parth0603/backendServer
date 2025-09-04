import bcrypt from 'bcryptjs';

// In-memory user storage
let users = [];
let userIdCounter = 1;

export class User {
  constructor(userData) {
    this.id = userIdCounter++;
    this.name = userData.name;
    this.email = userData.email.toLowerCase();
    this.password = userData.password;
    this.role = userData.role || 'user';
    this.googleId = userData.googleId || null;
    this.createdAt = new Date();
  }

  static async create(userData) {
    const hashedPassword = await bcrypt.hash(userData.password, 12);
    const user = new User({
      ...userData,
      password: hashedPassword
    });
    users.push(user);
    return user;
  }

  static async findOne(query) {
    return users.find(user => {
      if (query.email) return user.email === query.email.toLowerCase();
      if (query.id) return user.id === query.id;
      return false;
    });
  }

  static async findById(id) {
    return users.find(user => user.id === parseInt(id));
  }

  async comparePassword(password) {
    return await bcrypt.compare(password, this.password);
  }
}

export default User;