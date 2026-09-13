FROM php:8.3.24-cli-alpine

RUN apk add --no-cache caddy \
    && printf '%s\n' \
      'max_input_vars = 1000000' \
      > /usr/local/etc/php/conf.d/php.ini
WORKDIR /srv/app

COPY entrypoint.sh /srv/entrypoint.sh
RUN chmod +x /srv/entrypoint.sh

COPY . /srv/app
USER 404:404

EXPOSE 3000
ENTRYPOINT ["/srv/entrypoint.sh"]
