import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeocodeAddressDto } from './dto/geocode-address.dto';

@Injectable()
export class MapsService {
  constructor(private configService: ConfigService) {}

  private get apiKey() {
    const key = this.configService.get<string>('OPENROUTESERVICE_API_KEY');
    if (!key) {
      throw new BadRequestException(
        'OPENROUTESERVICE_API_KEY não configurada no .env',
      );
    }
    return key;
  }

  async geocodeAddress(address: GeocodeAddressDto) {
    const text = [
      address.streetAddress,
      address.number,
      address.neighborhood,
      address.city,
      address.state,
      address.zipCode,
      'Brasil',
    ]
      .filter(Boolean)
      .join(', ');

    const url = `https://api.openrouteservice.org/geocode/search?size=1&text=${encodeURIComponent(
      text,
    )}`;

    const response = await fetch(url, {
      headers: {
        Authorization: this.apiKey,
      },
    });

    if (!response.ok) {
      throw new BadRequestException('Erro ao consultar geocodificação');
    }

    const data = await response.json();

    if (!data?.features?.length) {
      throw new BadRequestException(
        'Não foi possível localizar este endereço no mapa',
      );
    }

    const feature = data.features[0];
    const [longitude, latitude] = feature.geometry.coordinates;
    const props = feature.properties || {};

    return {
      latitude,
      longitude,
      label: props.label || text,
      normalizedAddress: {
        streetAddress: props.street || address.streetAddress,
        number: props.housenumber || address.number || '',
        neighborhood:
          props.neighbourhood ||
          props.locality ||
          address.neighborhood ||
          '',
        city: props.locality || props.county || address.city,
        state: props.region || address.state,
        zipCode: props.postalcode || address.zipCode || '',
      },
    };
  }
}