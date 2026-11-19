import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { hashPassword, verifyPassword } from './password.js';
import { User } from './user.entity.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  findById(id: string) {
    return this.users.findOneBy({ id });
  }

  findByEmail(email: string) {
    return this.users.findOneBy({ email: normalizeEmail(email) });
  }

  async register(email: string, password: string): Promise<User> {
    if (await this.findByEmail(email)) {
      throw new ConflictException('An account with this email already exists');
    }
    return this.users.save(
      this.users.create({
        email: normalizeEmail(email),
        passwordHash: await hashPassword(password),
      }),
    );
  }

  /** The user, if the email and password match. */
  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<User | null> {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: normalizeEmail(email) })
      .getOne();
    const ok = await verifyPassword(password, user?.passwordHash);
    return ok && user ? user : null;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
