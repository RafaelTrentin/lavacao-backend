
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendPasswordResetEmail(
    recipient: string,
    resetUrl: string,
  ): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;

    if (!apiKey || !from) {
      this.logger.error('Resend nao configurado');
      throw new InternalServerErrorException(
        'Servico de email indisponivel',
      );
    }

    const message = [
      'Olá!',
      '',
      'Recebemos uma solicitação para redefinir sua senha no WashSync.',
      '',
      'Para criar uma nova senha, acesse:',
      resetUrl,
      '',
      'Este link é válido por 30 minutos e pode ser utilizado uma única vez.',
      '',
      'Se você não solicitou a redefinição, ignore este e-mail.',
      '',
      'Equipe WashSync',
    ].join('\n');

    try {
      const response = await fetch(
        'https://api.resend.com/emails',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [recipient],
            subject: 'Redefinição de senha — WashSync',
            text: message,
          }),
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!response.ok) {
        this.logger.error(
          `Falha no envio pelo Resend. HTTP ${response.status}`,
        );
        throw new Error('Resend recusou o envio');
      }
    } catch {
      this.logger.error('Nao foi possivel enviar email de recuperacao');
      throw new InternalServerErrorException(
        'Servico de email temporariamente indisponivel',
      );
    }
  }
}
