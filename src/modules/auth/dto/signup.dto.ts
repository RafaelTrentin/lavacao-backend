import { IsEmail, IsString, MinLength, Equals, Matches } from 'class-validator';
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

  @Equals(UserRole.CUSTOMER, {
    message: 'O cadastro público permite somente CUSTOMER',
  })
  role: UserRole.CUSTOMER;

  @IsString()
  @Matches(/\S/, { message: 'Informe o slug da empresa' })
  businessSlug: string;
}
