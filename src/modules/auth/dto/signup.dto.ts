import { IsEmail, IsString, MinLength, IsEnum } from 'class-validator';
import { UserRole } from 'src/common/enums';

export class SignupDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(3)
  name: string;

  @IsString()
  phone: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsString()
  businessSlug: string;
}