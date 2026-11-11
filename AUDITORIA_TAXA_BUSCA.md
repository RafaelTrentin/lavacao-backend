# Taxa de busca: endereço manual e localização atual

## Regra comercial autorizada

O usuário definiu que endereço manual permanece com taxa a confirmar. O dono decide se cobra e combina o valor fora do aplicativo. Não existe aprovação, cobrança ou edição dessa taxa dentro do WashSync.

Consequentemente, endereço manual não é geocodificado para precificação e não adiciona taxa ao valor do serviço, mesmo quando há coordenadas em endereço salvo. Não foi criado estado persistido, migração ou fluxo administrativo de confirmação.

## Alterações

- Estimativa manual e criação agora seguem a mesma regra. A estimativa retorna `searchFeeStatus: TO_CONFIRM_EXTERNALLY`, `searchFeeInCents: 0`, `distanceKm: null` e o valor base. Zero significa ausência de acréscimo contabilizado no app, não promessa de gratuidade da busca.
- Novos agendamentos manuais armazenam distância `null` em vez de inventar `0 km`. Os snapshots monetários existentes não são alterados. O campo de distância já era nullable no schema.
- Respostas de criação, consultas e transições de agendamento adicionam `searchFeeStatus`, derivado de `willSearchVehicle`/`searchType`: `NOT_APPLICABLE`, `CALCULATED` ou `TO_CONFIRM_EXTERNALLY`. Isso também sinaliza registros manuais antigos sem regravá-los. A criação inclui `searchType` na resposta.
- Endereço salvo continua sujeito à propriedade do cliente e da empresa. Entrada manual exige rua, cidade e estado; não exige sucesso de geocodificação para reservar.
- Localização atual continua sendo calculada no servidor. DTOs/serviço rejeitam tipos de busca inválidos e coordenadas ausentes, não finitas ou fora da faixa. Não se aceitam taxa/distância do cliente como preço definitivo.
- Frontend esclarece que a eventual taxa manual é combinada fora do app e não está incluída no valor exibido, no resumo, lista do cliente e avisos administrativos. Estimativa GPS indisponível não aparece como zero nem permite confirmação até haver orçamento válido.

## Preservações e limites

Mantidos valores configurados, Haversine (distância em linha reta), arredondamento e faixas: zero de distância gera zero de taxa; até o limite usa a primeira tarifa; acima usa a segunda. O limite não é raio máximo de atendimento. Relatórios continuam contabilizando somente os valores registrados no app; acordos externos não entram neles.

GPS é uma coordenada informada pelo dispositivo: validação numérica não comprova fisicamente a presença do cliente. `MapsService` continua aceitando o primeiro resultado do provedor sem qualificar precisão; o teste documenta esse limite. Endereço manual deixou de depender desse resultado para precificação. O fallback existente de geocodificação do endereço da própria empresa no fluxo GPS não foi redesenhado.

Contratos de requisição e campos monetários existentes foram preservados; o indicador é aditivo. Na estimativa manual, distância passa a `null`: os clientes Web/Android locais examinados não chamam essa estimativa no modo manual. As telas embarcadas precisam de nova AAB para receber os novos textos e a proteção visual contra falha de estimativa GPS. Nenhuma AAB foi gerada.

## Validação

19 testes isolados de taxa/mapas: GPS, endereço manual geocodificável/não localizado, endereço salvo, negociação externa, propriedade/tenant, coordenadas inválidas, faixas de distância, snapshots históricos e rejeição de valores enviados pelo cliente. Prisma e provedor de mapas são simulados; nenhum endereço/cliente real foi consultado.

Suíte backend: 257 testes aprovados (28 testes PostgreSQL da etapa anterior não executados nesta rodada normal). Frontend: 48 testes aprovados. Builds backend/frontend e TypeScript frontend aprovados. Build Web mantém avisos conhecidos de tamanho do bundle e Browserslist desatualizado.

Sem produção, alteração de taxas reais, migração, commit, push, deploy ou geração de AAB.
