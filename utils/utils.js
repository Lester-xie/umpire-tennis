export const getDate = () => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  return [year, month, day].map(formatNumber).join('/');
};

export const getTime = () => {
  const hour = date.getHours();
  const minute = date.getMinutes();
  const second = date.getSeconds();

  return [hour, minute, second].map(formatNumber).join(':');
};