FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY CallPilot.Server.Api/*.csproj CallPilot.Server.Api/
COPY CallPilot.Server.Application/*.csproj CallPilot.Server.Application/
COPY CallPilot.Server.Domain/*.csproj CallPilot.Server.Domain/
COPY CallPilot.Server.Infrastructure/*.csproj CallPilot.Server.Infrastructure/
COPY CallPilot.Server.Shared/*.csproj CallPilot.Server.Shared/
COPY CallPilot.slnx .

RUN dotnet restore

COPY . .
RUN dotnet publish CallPilot.Server.Api/CallPilot.Server.Api.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .

EXPOSE 8080

ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "CallPilot.Server.Api.dll"]
