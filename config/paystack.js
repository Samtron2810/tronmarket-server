import axios from "axios";

const paystackApi = axios.create({
  baseURL: "https://api.paystack.co",
});

// Attach the secret key at request-time so it's read after dotenv has loaded,
// regardless of module import order.
paystackApi.interceptors.request.use((config) => {
  config.headers = {
    ...(config.headers || {}),
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
  return config;
});

export default paystackApi;
