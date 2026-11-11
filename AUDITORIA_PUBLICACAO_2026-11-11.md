# Auditoria de publicação — 11/11/2026

## Atualização para retomada autorizada

O responsável confirmou que a única empresa ativa utiliza America/Sao_Paulo e autorizou preservar as correções IANA sem camada adicional para aplicativos legados em outros fusos. Foi acrescentado teste PostgreSQL de criação e reagendamento administrativo/cliente com o payload -03:00 da versão 1.0.3 nesse fuso. A restrição de outros fusos permanece documentada para expansão futura, mas não impede esta publicação autorizada.

O artefato de build foi corrigido configurando `tsBuildInfoFile` dentro de `dist`. Dois builds consecutivos produziram `dist/main.js`; a API compilada iniciou em smoke test com conexão Prisma simulada. Nenhum comando de produção foi alterado. Os itens abaixo registram a interrupção anterior, não o resultado desta retomada.

## Decisão: publicação interrompida antes de commit/push

Conforme a instrução de interromper diante de incompatibilidade ou risco relevante, as etapas de versionamento/publicação não foram executadas. Nenhum arquivo enviado ao GitHub, nenhum novo hash de commit, nenhum deploy solicitado. Railway/Vercel não foram validados como novos deploys porque não houve publicação desta rodada.

Bases locais: backend `57219c2`; frontend `09870af` (versão Android 1.0.3). Ambos em `main`, com alterações locais de agenda, timezone, contratos de escrita, notificações, Web Push, taxa manual, fechamento de períodos e apresentação de horários. Nenhuma alteração no schema Prisma ou nos arquivos Android nesta rodada.

## Bloqueio 1: artefato executável ausente

`npm run build` do backend encerrou com código 0, mas `dist/main.js` não existe após o build. O comando de produção é `node dist/main.js`. A checagem explícita de existência falhou. Logo, o sucesso do comando de compilação não valida o pacote executável; relatórios anteriores que o chamaram simplesmente de build aprovado eram insuficientes.

A configuração habilita compilação incremental e remove `dist` antes de compilar, mantendo `tsconfig.build.tsbuildinfo` fora de `dist`. Essa combinação precisa ser investigada/corrigida e testada com builds consecutivos e inicialização real, não apenas com código de saída. Não se afirma que um build limpo no Railway falhará, mas a reprodutibilidade local atual não está aprovada.

## Bloqueio 2: compatibilidade Android não universal

Foi inspecionada, sem alterar, a AAB local `android/app/release/app-release.aab`, associada ao workspace com `versionName 1.0.3` e `versionCode 4`. SHA-256: `0CB3EBD0AD91FD205E1F64A770FD7D01CA09A2BC766BEF95E1D54B5D66F80CCB`.

O bundle `base/assets/public/assets/index-KVCBFgnU.js` constrói criação e reagendamento como `data + startTime + :00-03:00`. Não usa o instante UTC recebido nos slots. A correspondência dessa AAB com o binário publicado na Play Store foi assumida a partir do artefato local e da informação do usuário; não houve consulta à Play Console.

Reprodução com os helpers reais de timezone do backend, sem banco: selecionando 08:00 em 08/01/2035, a AAB envia 11:00 UTC. Isso corresponde a 08:00 em São Paulo, mas a 07:00 em Manaus e 06:00 em Rio Branco. O backend novo interpreta a agenda pelo fuso da empresa. Portanto, não é possível atestar compatibilidade geral com 1.0.3: fora de UTC−3 há risco de recusa ou reserva em horário diferente. Não foi consultada a configuração de empresas de produção, então o impacto atual por empresa não está quantificado.

Os demais contratos examinados preservam o array legado de slots, campos antigos e URL FCM `/notifications`; o indicador de taxa é aditivo, e fechamento impede reservas antigas no servidor. Recursos visuais novos exigem outra AAB, mas o bloqueio identificado aqui é a montagem do instante de agendamento.

## Validações executadas

- Backend: 261 testes normais aprovados.
- PostgreSQL local descartável: 31 testes reais aprovados, incluindo concorrência, fechamento, rollback e notificações. Somente schema/dados sintéticos do banco local de testes; nenhuma migração de produção.
- Frontend: 52 testes aprovados, TypeScript aprovado e build Vite aprovado.
- Build backend: comando encerra com sucesso, mas validação do artefato reprovada.
- `git diff --check` sem erros; avisos de conversão LF/CRLF.
- Build Web mantém avisos conhecidos de tamanho do bundle e Browserslist desatualizado.

## Arquivos e dados sensíveis

Inspeção dos diffs e varredura de padrões de segredos nos arquivos modificados/não rastreados não encontraram chaves privadas, tokens GitHub/AWS ou chaves de pagamento nesses candidatos. Isso não constitui garantia absoluta de ausência de segredos. Arquivos `.env` locais não são candidatos à publicação. A demonstração local usa arquivos em TEMP, fora dos repositórios; não será incluída. O documento `WASHSYNC_CONTEXTO_TECNICO.md` é referência local não rastreada e não precisa integrar o commit das correções. AAB, arquivos Android e credenciais locais ficam excluídos.

## Estratégia proposta antes de retomar

1. Corrigir e verificar a geração do executável backend em builds limpos e consecutivos; testar startup isolado.
2. Definir compatibilidade para clientes legados: preferencialmente um contrato de versão explícito que permita tratar horários legados sem alterar silenciosamente o significado de timestamps modernos. Alternativa: separar a mudança de timezone da publicação das demais correções até planejar a atualização Android. Apenas publicar uma nova AAB não resolve imediatamente instalações antigas.
3. Acrescentar regressões para payloads efetivos da 1.0.3 e do frontend novo em UTC−3 e outros fusos.
4. Revalidar; então commit/push backend, confirmar revisão implantada no Railway por evidência de deploy e verificações sem escrita; só depois commit/push frontend e verificação Vercel.

A próxima AAB ainda não está liberada como etapa de publicação: primeiro resolver os bloqueios e escolher a estratégia de convivência. Nenhuma AAB foi gerada, variável de ambiente de projeto/produção alterada ou dado real modificado nesta auditoria.
