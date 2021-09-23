const posts = [
  {
    id: '1'
  }
];

module.exports = {
  Query: {
    // eslint-disable-next-line no-unused-vars
    posts: async (parent, args, context, info) => { return posts;},
    // post: () => {},
  },
  Post: {
    // eslint-disable-next-line no-unused-vars
    comments: async (parent, args, context, info) => {},
  },
};

